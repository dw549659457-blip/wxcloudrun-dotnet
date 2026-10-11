using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Integrations;
using aspnetapp.Repositories;
using MySqlConnector;

namespace aspnetapp.Services;

public sealed record SessionResult(long UserId, string Name, string[] Roles, string Token, string? CsrfToken, string? SelectedRole = null, string[]? Permissions = null, string Username = "");

public sealed class AuthService(Database database, TransactionService transactions, DocumentRepository audit, IWechatGateway wechat, AppSettings settings)
{
    private static readonly string DummyPasswordHash = PasswordService.Hash("unused-password-for-timing");
    public static async Task<string[]> UserRoles(MySqlConnection connection, MySqlTransaction? transaction, long userId)
    {
        var rows = await Database.Query(connection, transaction, "SELECT Role FROM UserRoles WHERE UserId=@id ORDER BY Role", ("id", userId));
        return rows.Select(row => row.Text("Role")).ToArray();
    }
    private async Task<SessionResult> Session(MySqlConnection connection, MySqlTransaction transaction, Row user, string type)
    {
        var token = PasswordService.Token();
        var csrf = type == SessionTypes.WebAdmin ? PasswordService.Token() : null;
        var roles = await UserRoles(connection, transaction, user.Id("Id"));
        var preferredRole = user.IsNull("PreferredRole") ? null : user.Text("PreferredRole");
        var selectedRole = preferredRole is not null && roles.Contains(preferredRole) ? preferredRole : roles.FirstOrDefault();
        await Database.Execute(connection, transaction, "INSERT INTO Sessions(TokenHash,UserId,SessionType,CsrfHash,SelectedRole,ExpiresAt) VALUES(@hash,@user,@type,@csrf,@selected,@expiry)",
            [("hash", TransactionService.Hash(token)), ("user", user.Id("Id")), ("type", type), ("selected", selectedRole), ("csrf", csrf is null ? null : TransactionService.Hash(csrf)), ("expiry", DateTime.UtcNow.AddHours(type == SessionTypes.WebAdmin ? 8 : 168))]);
        return new(user.Id("Id"), user.Text("Name"), roles, token, csrf, selectedRole,
            type == SessionTypes.WebAdmin ? await PermissionService.Effective(connection, transaction, roles) : [], user.Text("Username"));
    }
    public async Task<SessionResult> Login(LoginInput input, string address, bool development)
    {
        if (development && (!settings.DevelopmentLogin || settings.Production))
        {
            throw new BusinessException(404, "NOT_FOUND", "此环境未开放开发登录");
        }

        if (input.Username.Length is < 1 or > 80 || input.Password.Length is < 1 or > 128)
        {
            throw BusinessException.Invalid("请输入账号和密码");
        }
        // 先提交失败计数，即使后续密码校验抛错也不回滚限频记录；跨副本共享 MySQL。
        var attemptKey = TransactionService.Hash(address + "|" + input.Username);
        await transactions.Run(async (connection, transaction) =>
        {
            await Database.Execute(connection, transaction, "INSERT IGNORE INTO LoginAttempts VALUES(@key,0,UTC_TIMESTAMP(6))", [("key", attemptKey)]);
            var rows = await Database.Query(connection, transaction, "SELECT * FROM LoginAttempts WHERE AttemptKey=@key FOR UPDATE", ("key", attemptKey));
            if (rows[0].DateTime("WindowStart") < DateTime.UtcNow.AddMinutes(-15))
            {
                await Database.Execute(connection, transaction, "UPDATE LoginAttempts SET Attempts=0,WindowStart=UTC_TIMESTAMP(6) WHERE AttemptKey=@key", [("key", attemptKey)]);
            }
            else if (rows[0].Id("Attempts") >= 10)
            {
                throw new BusinessException(429, "LOGIN_RATE_LIMIT", "尝试次数较多，请 15 分钟后再试");
            }

            await Database.Execute(connection, transaction, "UPDATE LoginAttempts SET Attempts=Attempts+1 WHERE AttemptKey=@key", [("key", attemptKey)]);
            return true;
        });
        await using var lookup = await database.Open();
        var users = await Database.Query(lookup, null, "SELECT * FROM Users WHERE Username=@username", ("username", input.Username));
        var hash = users.Count == 0 || users[0].IsNull("PasswordHash") ? DummyPasswordHash : users[0].Text("PasswordHash");
        if (!PasswordService.Verify(input.Password, hash) || users.Count == 0 || !users[0].Flag("Enabled") || users[0].IsNull("PasswordHash"))
        {
            throw new BusinessException(401, "INVALID_CREDENTIALS", "账号或密码不正确，或账号已停用");
        }

        var roles = await UserRoles(lookup, null, users[0].Id("Id"));
        if (!development && !Roles.BackOffice(roles))
        {
            throw new BusinessException(403, "FORBIDDEN", "该账号不能登录管理后台");
        }

        return await transactions.Run(async (connection, transaction) =>
        {
            var current = await Database.Query(connection, transaction, "SELECT * FROM Users WHERE Id=@id AND Enabled=TRUE FOR UPDATE", ("id", users[0].Id("Id")));
            if (current.Count == 0)
            {
                throw new BusinessException(401, "ACCOUNT_DISABLED", "账号已停用");
            }

            await Database.Execute(connection, transaction, "DELETE FROM LoginAttempts WHERE AttemptKey=@key", [("key", attemptKey)]);
            return await Session(connection, transaction, current[0], development ? SessionTypes.Miniprogram : SessionTypes.WebAdmin);
        });
    }
    public async Task<Actor> Authenticate(HttpContext context)
    {
        if (context.Items["AuthenticatedActor"] is Actor authenticated) return authenticated;
        var authorization = context.Request.Headers.Authorization.ToString();
        var bearer = authorization.StartsWith("Bearer ", StringComparison.Ordinal) ? authorization[7..] : null;
        var cookie = context.Request.Cookies["warehouse_session"];
        var token = bearer ?? cookie;
        if (token is null || token.Length != 64)
        {
            throw new BusinessException(401, "UNAUTHENTICATED", "请先进入系统");
        }

        await using var connection = await database.Open();
        var tokenHash = TransactionService.Hash(token);
        var rows = await Database.Query(connection, null, "SELECT s.*,u.Username,u.Name,u.Enabled FROM Sessions s JOIN Users u ON u.Id=s.UserId WHERE s.TokenHash=@hash AND s.ExpiresAt>UTC_TIMESTAMP(6) AND s.RevokedAt IS NULL", ("hash", tokenHash));
        if (rows.Count == 0 || !rows[0].Flag("Enabled"))
        {
            throw new BusinessException(401, "SESSION_EXPIRED", "登录已过期，请重新进入");
        }

        var session = rows[0];
        var roles = await UserRoles(connection, null, session.Id("UserId"));
        var selectedRole = session.IsNull("SelectedRole") ? roles.FirstOrDefault() : session.Text("SelectedRole");
        if (selectedRole is not null && !roles.Contains(selectedRole)) selectedRole = roles.FirstOrDefault();
        var actor = new Actor(session.Id("UserId"), session.Text("Name"), roles, session.Text("SessionType"), tokenHash, selectedRole,
            session.Text("SessionType") == SessionTypes.WebAdmin ? await PermissionService.Effective(connection, null, roles) : [], session.Text("Username"));
        context.Items["AuditActor"] = actor;
        if (session.Text("SessionType") == SessionTypes.WebAdmin)
        {
            if (bearer is not null || !Roles.BackOffice(roles))
            {
                throw new BusinessException(401, "SESSION_INVALID", "请使用后台网页登录");
            }

            if (context.Request.Method is not ("GET" or "HEAD" or "OPTIONS"))
            {
                var csrf = context.Request.Headers["X-CSRF-Token"].ToString();
                if (TransactionService.Hash(csrf) != session.Text("CsrfHash"))
                {
                    throw new BusinessException(403, "CSRF_REJECTED", "页面验证过期，请重新登录");
                }
                // 同站 Cookie + 不开放 CORS + CSRF 随机会话令牌，阻止跨站写操作。
                if (context.Request.Headers.TryGetValue("Origin", out var origin) && (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Authority != context.Request.Host.Value))
                {
                    throw new BusinessException(403, "CSRF_REJECTED", "请求来源不匹配");
                }
            }
        }
        else if (bearer is null)
        {
            throw new BusinessException(401, "SESSION_INVALID", "员工会话需要 Bearer 令牌");
        }

        context.Items["AuthenticatedActor"] = actor;
        return actor;
    }
    public Task SelectRole(Actor actor, string role) => transactions.Run(async (connection, transaction) =>
    {
        var currentRoles = await UserRoles(connection, transaction, actor.Id);
        if (!currentRoles.Contains(role))
        {
            throw new BusinessException(403, "FORBIDDEN", "请选择您已分配的身份");
        }

        await Database.Execute(connection, transaction, "UPDATE Sessions SET SelectedRole=@role WHERE TokenHash=@hash", [("role", role), ("hash", actor.TokenHash)]);
        await Database.Execute(connection, transaction, "UPDATE Users SET PreferredRole=@role WHERE Id=@user", [("role", role), ("user", actor.Id)]);
        return true;
    });
    public Task Logout(Actor actor) => transactions.Run(async (connection, transaction) =>
    {
        await Database.Execute(connection, transaction, "UPDATE Sessions SET RevokedAt=UTC_TIMESTAMP(6) WHERE TokenHash=@hash", [("hash", actor.TokenHash)]);
        return true;
    });
    public async Task<object> WechatLogin(string code)
    {
        var identity = await wechat.Identity(code);
        return await transactions.Run<object>(async (connection, transaction) =>
        {
            var users = await Database.Query(connection, transaction, "SELECT * FROM Users WHERE AppId=@appid AND OpenId=@openid FOR UPDATE", ("appid", identity.AppId), ("openid", identity.OpenId));
            if (users.Count > 0)
            {
                if (!users[0].Flag("Enabled"))
                {
                    throw new BusinessException(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员");
                }

                return await Session(connection, transaction, users[0], SessionTypes.Miniprogram);
            }
            var token = PasswordService.Token();
            await Database.Execute(connection, transaction, "INSERT INTO Bindings(TokenHash,AppId,OpenId,Status,ExpiresAt,CreatedAt) VALUES(@hash,@appid,@openid,'PENDING_PHONE',@expiry,UTC_TIMESTAMP(6))", [("hash", TransactionService.Hash(token)), ("appid", identity.AppId), ("openid", identity.OpenId), ("expiry", DateTime.UtcNow.AddMinutes(15))]);
            return new { bindingToken = token, status = BindingStatuses.PendingPhone, expiresInSeconds = 900 };
        });
    }
    private static async Task<Row> Binding(MySqlConnection connection, MySqlTransaction transaction, string token)
    {
        if (token.Length != 64)
        {
            throw new BusinessException(401, "BINDING_EXPIRED", "请重新开始身份确认");
        }

        var rows = await Database.Query(connection, transaction, "SELECT * FROM Bindings WHERE TokenHash=@hash AND ExpiresAt>UTC_TIMESTAMP(6) FOR UPDATE", ("hash", TransactionService.Hash(token)));
        if (rows.Count == 0 || rows[0].Text("Status") is BindingStatuses.Consumed or BindingStatuses.Rejected or BindingStatuses.Revoked)
        {
            throw new BusinessException(401, "BINDING_EXPIRED", "请重新开始身份确认或联系管理员");
        }

        return rows[0];
    }
    public async Task<object> BindPhone(PhoneBindingInput input)
    {
        var phone = await wechat.Phone(input.PhoneCode);
        return await transactions.Run<object>(async (connection, transaction) =>
        {
            var binding = await Binding(connection, transaction, input.BindingToken);
            if (binding.Text("Status") != BindingStatuses.PendingPhone)
            {
                throw BusinessException.Conflict("BINDING_STATE", "该身份已进入确认或审批流程");
            }

            var users = await Database.Query(connection, transaction, "SELECT * FROM Users WHERE Phone=@phone AND Enabled=TRUE FOR UPDATE", ("phone", phone));
            if (users.Count == 0)
            {
                throw new BusinessException(403, "EMPLOYEE_NOT_REGISTERED", "还没找到您的账号，请联系管理员登记");
            }

            if (!users[0].IsNull("OpenId"))
            {
                throw BusinessException.Conflict("ALREADY_BOUND", "账号已绑定其他微信，请联系管理员核实");
            }

            await Database.Execute(connection, transaction, "UPDATE Bindings SET CandidateUserId=@user,Status='PENDING_CONFIRM' WHERE Id=@id", [("user", users[0].Id("Id")), ("id", binding.Id("Id"))]);
            return new { status = BindingStatuses.PendingConfirm, name = users[0].Text("Name"), roles = await UserRoles(connection, transaction, users[0].Id("Id")) };
        });
    }
    public Task<object> RequestHelp(string token) => transactions.Run<object>(async (connection, transaction) =>
    {
        var binding = await Binding(connection, transaction, token);
        if (binding.Text("Status") is not (BindingStatuses.PendingPhone or BindingStatuses.PendingConfirm or BindingStatuses.PendingApproval))
        {
            throw BusinessException.Conflict("BINDING_STATE", "申请状态已改变");
        }

        await Database.Execute(connection, transaction, "UPDATE Bindings SET Status='PENDING_APPROVAL',CandidateUserId=NULL,ExpiresAt=@expiry WHERE Id=@id", [("id", binding.Id("Id")), ("expiry", DateTime.UtcNow.AddDays(7))]);
        return new { requestId = binding.Id("Id"), status = BindingStatuses.PendingApproval };
    });
    public Task<object> BindingStatus(string token) => transactions.Run<object>(async (connection, transaction) =>
    {
        var binding = await Binding(connection, transaction, token);
        object? candidate = null;
        if (!binding.IsNull("CandidateUserId"))
        {
            var users = await Database.Query(connection, transaction, "SELECT Name FROM Users WHERE Id=@id", ("id", binding.Id("CandidateUserId")));
            candidate = new { name = users[0].Text("Name"), roles = await UserRoles(connection, transaction, binding.Id("CandidateUserId")) };
        }
        return new { status = binding.Text("Status"), candidate };
    });
    public Task<SessionResult> Confirm(string token, string requestId) => transactions.Run(async (connection, transaction) =>
    {
        var binding = await Binding(connection, transaction, token);
        if (binding.Text("Status") is not (BindingStatuses.PendingConfirm or BindingStatuses.Approved) || binding.IsNull("CandidateUserId"))
        {
            throw new BusinessException(403, "BINDING_NOT_APPROVED", "请先完成手机号确认或管理员协助");
        }

        var users = await Database.Query(connection, transaction, "SELECT * FROM Users WHERE Id=@id AND Enabled=TRUE FOR UPDATE", ("id", binding.Id("CandidateUserId")));
        if (users.Count == 0 || !users[0].IsNull("OpenId"))
        {
            throw BusinessException.Conflict("ALREADY_BOUND", "账号状态已改变，请联系管理员");
        }

        await Database.Execute(connection, transaction, "UPDATE Users SET AppId=@appid,OpenId=@openid WHERE Id=@id", [("appid", binding.Text("AppId")), ("openid", binding.Text("OpenId")), ("id", users[0].Id("Id"))]);
        await Database.Execute(connection, transaction, "UPDATE Bindings SET Status='CONSUMED' WHERE Id=@id", [("id", binding.Id("Id"))]);
        var actor = new Actor(users[0].Id("Id"), users[0].Text("Name"), [], SessionTypes.Miniprogram, "");
        await audit.Audit(connection, transaction, actor, "CONFIRM_BINDING", "USER", actor.Id, null, new { bound = true }, "本人确认", requestId);
        return await Session(connection, transaction, users[0], SessionTypes.Miniprogram);
    });
    public Task<object> Decide(Actor actor, long id, BindingDecisionInput decision, bool approve, string requestId)
    {
        actor.Require(Roles.Admin);
        if (string.IsNullOrWhiteSpace(decision.Reason) || decision.Reason.Length > 500)
        {
            throw BusinessException.Invalid("请填写线下核实/拒绝理由");
        }

        return transactions.Run<object>(async (connection, transaction) =>
        {
            var rows = await Database.Query(connection, transaction, "SELECT * FROM Bindings WHERE Id=@id AND Status='PENDING_APPROVAL' AND ExpiresAt>UTC_TIMESTAMP(6) FOR UPDATE", ("id", id));
            if (rows.Count == 0)
            {
                throw BusinessException.Conflict("BINDING_STATE", "申请不存在、过期或已处理");
            }

            if (approve)
            {
                var users = await Database.Query(connection, transaction, "SELECT * FROM Users WHERE Id=@id AND Enabled=TRUE FOR UPDATE", ("id", decision.UserId));
                if (users.Count == 0 || !users[0].IsNull("OpenId"))
                {
                    throw BusinessException.Conflict("ALREADY_BOUND", "请选择启用且未绑定的预录员工");
                }
            }
            await Database.Execute(connection, transaction, "UPDATE Bindings SET Status=@status,CandidateUserId=@user,ApprovedBy=@actor,Reason=@reason,ExpiresAt=@expiry WHERE Id=@id", [("status", approve ? BindingStatuses.Approved : BindingStatuses.Rejected), ("user", approve ? decision.UserId : null), ("actor", actor.Id), ("reason", decision.Reason), ("expiry", DateTime.UtcNow.AddDays(1)), ("id", id)]);
            await audit.Audit(connection, transaction, actor, approve ? "APPROVE_BINDING" : "REJECT_BINDING", "BINDING", id, null, new { decision.UserId, approve }, decision.Reason, requestId);
            return new { id, status = approve ? BindingStatuses.Approved : BindingStatuses.Rejected };
        });
    }
    public Task Unbind(Actor actor, long userId, string reason, string requestId)
    {
        actor.Require(Roles.Admin);
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 500)
        {
            throw BusinessException.Invalid("解除绑定需填写核实原因");
        }

        return transactions.Run(async (connection, transaction) =>
        {
            await Database.Execute(connection, transaction, "UPDATE Bindings b JOIN Users u ON u.AppId=b.AppId AND u.OpenId=b.OpenId SET b.Status='REVOKED' WHERE u.Id=@id", [("id", userId)]);
            await Database.Execute(connection, transaction, "UPDATE Users SET AppId=NULL,OpenId=NULL WHERE Id=@id", [("id", userId)]);
            await Database.Execute(connection, transaction, "UPDATE Sessions SET RevokedAt=UTC_TIMESTAMP(6) WHERE UserId=@id", [("id", userId)]);
            await audit.Audit(connection, transaction, actor, "UNBIND", "USER", userId, new { bound = true }, new { bound = false }, reason, requestId);
            return true;
        });
    }
}
