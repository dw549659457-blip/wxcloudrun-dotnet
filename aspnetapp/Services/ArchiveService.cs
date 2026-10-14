using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Repositories;

namespace aspnetapp.Services;

public sealed class ArchiveService(TransactionService transactions, DocumentRepository audit)
{
    public static string Kind(string path) => path switch
    {
        "growers" => ArchiveKinds.Grower,
        "packaging-types" => ArchiveKinds.Packaging,
        "vegetable-types" => InventoryDomains.Vegetable,
        "customers" => ArchiveKinds.Customer,
        _ => throw new BusinessException(404, "NOT_FOUND", "未知档案类型")
    };
    public Task<object> Save(Actor actor, string kind, long? id, ArchiveInput input, string requestId)
    {
        actor.RequirePermission("archives.write");
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 100 || input.Specification.Length > 200 || input.Contact.Length > 80 || input.Phone.Length > 32 || input.Unit.Length > 16)
        {
            throw BusinessException.Invalid("档案名称或字段长度无效");
        }

        if (kind == InventoryDomains.Vegetable && input.Unit is not ("箱" or "公斤"))
        {
            throw BusinessException.Invalid("蔬菜库存单位只允许箱或公斤");
        }

        if (kind == ArchiveKinds.Packaging && string.IsNullOrWhiteSpace(input.Unit))
        {
            throw BusinessException.Invalid("包装需要填写单位");
        }

        return transactions.Run<object>(async (connection, transaction) =>
        {
            Row? previous = null;
            if (id is not null)
            {
                var rows = await Database.Query(connection, transaction, "SELECT * FROM Archives WHERE Id=@id AND Kind=@kind FOR UPDATE", ("id", id), ("kind", kind));
                if (rows.Count == 0)
                {
                    throw new BusinessException(404, "NOT_FOUND", "未找到档案");
                }

                previous = rows[0];
                if (previous.Text("Unit") != input.Unit)
                {
                    var references = await Database.Query(connection, transaction, "SELECT Id FROM DocumentItems WHERE ItemId=@id LIMIT 1", ("id", id));
                    if (references.Count > 0)
                    {
                        throw BusinessException.Conflict("UNIT_IMMUTABLE", "已使用品类不能改变库存单位，请新建档案");
                    }
                }
                await Database.Execute(connection, transaction, "UPDATE Archives SET Name=@name,Unit=@unit,Specification=@specification,Contact=@contact,Phone=@phone,Enabled=@enabled WHERE Id=@id", [("name", input.Name), ("unit", input.Unit), ("specification", input.Specification), ("contact", input.Contact), ("phone", input.Phone), ("enabled", input.Enabled), ("id", id)]);
            }
            else
            {
                id = await Database.Insert(connection, transaction, "INSERT INTO Archives(Kind,Name,Unit,Specification,Contact,Phone,Enabled) VALUES(@kind,@name,@unit,@specification,@contact,@phone,@enabled)", ("kind", kind), ("name", input.Name), ("unit", input.Unit), ("specification", input.Specification), ("contact", input.Contact), ("phone", input.Phone), ("enabled", input.Enabled));
                if (kind is ArchiveKinds.Packaging or InventoryDomains.Vegetable)
                {
                    await Database.Execute(connection, transaction, "INSERT INTO InventoryBalances(ItemId) VALUES(@id)", [("id", id)]);
                }
            }
            await audit.Audit(connection, transaction, actor, previous is null ? "CREATE_ARCHIVE" : "UPDATE_ARCHIVE", kind, id.Value, previous?.Output(), input, "", requestId);
            return new { id };
        });
    }
    public Task<object> SaveUser(Actor actor, long? id, UserInput input, string requestId)
    {
        actor.RequirePersonnelManagement();
        PersonnelManagement.RequirePasswordAuthority(actor, input.Password);
        PersonnelManagement.RequireScope(actor, input.Roles ?? []);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 80 || input.Username.Length is < 1 or > 80 || input.Roles is null || input.Roles.Length == 0 || input.Roles.Any(role => !Roles.All.Contains(role)))
        {
            throw BusinessException.Invalid("请输入姓名、唯一账号和有效角色");
        }

        if (!System.Text.RegularExpressions.Regex.IsMatch(input.Phone, "^1[3-9][0-9]{9}$"))
        {
            throw BusinessException.Invalid("手机号须为 11 位中国大陆手机号");
        }

        if (input.Password is not null && input.Password.Length is < 12 or > 128)
        {
            throw BusinessException.Invalid("密码需 12—128 字符");
        }

        if (id is null && Roles.BackOffice(input.Roles) && input.Password is null)
        {
            throw BusinessException.Invalid("管理员或后台管理员需设置独立密码");
        }

        var passwordHash = input.Password is null ? null : PasswordService.Hash(input.Password);
        return transactions.Run<object>(async (connection, transaction) =>
        {
            actor = await PersonnelManagement.RequireCurrent(connection, transaction, actor, input.Roles);
            PersonnelManagement.RequirePasswordAuthority(actor, input.Password);
            Row? previous = null;
            string[]? previousRoles = null;
            if (id is null)
            {
                id = await Database.Insert(connection, transaction, "INSERT INTO Users(Username,Name,Phone,PasswordHash,Enabled,CreatedAt) VALUES(@username,@name,@phone,@password,@enabled,UTC_TIMESTAMP(6))", ("username", input.Username), ("name", input.Name), ("phone", input.Phone), ("password", passwordHash), ("enabled", input.Enabled));
            }
            else
            {
                var rows = await Database.Query(connection, transaction, "SELECT Id,Username,Name,Phone,Enabled,PasswordHash FROM Users WHERE Id=@id FOR UPDATE", ("id", id));
                if (rows.Count == 0)
                {
                    throw new BusinessException(404, "NOT_FOUND", "未找到用户");
                }

                previous = rows[0];
                previousRoles = await AuthService.UserRoles(connection, transaction, id.Value);
                PersonnelManagement.RequireScope(actor, previousRoles);
                if (Roles.BackOffice(input.Roles) && !Roles.BackOffice(previousRoles) && passwordHash is null)
                    throw BusinessException.Invalid("升级为后台账号需设置独立密码");
                if (Roles.BackOffice(input.Roles) && passwordHash is null && previous.IsNull("PasswordHash"))
                {
                    throw BusinessException.Invalid("后台账号需要密码");
                }

                var admins = await Database.Query(connection, transaction, "SELECT DISTINCT u.Id FROM Users u JOIN UserRoles r ON r.UserId=u.Id WHERE u.Enabled=TRUE AND r.Role='ADMIN'");
                if (admins.Count == 1 && admins[0].Id("Id") == id && (!input.Enabled || !input.Roles.Contains(Roles.Admin)))
                {
                    throw BusinessException.Conflict("LAST_ADMIN", "不能停用或移除最后一名管理员");
                }
                // 手机号改变视为身份需重新确认，撤销旧绑定和全部会话，不自动认领新号码。
                if (previous.Text("Phone") != input.Phone)
                {
                    await Database.Execute(connection, transaction, "UPDATE Bindings SET Status='REVOKED' WHERE CandidateUserId=@id", [("id", id)]);
                    await Database.Execute(connection, transaction, "UPDATE Users SET AppId=NULL,OpenId=NULL WHERE Id=@id", [("id", id)]);
                }
                await Database.Execute(connection, transaction, "UPDATE Users SET Username=@username,Name=@name,Phone=@phone,PasswordHash=COALESCE(@password,PasswordHash),Enabled=@enabled WHERE Id=@id", [("username", input.Username), ("name", input.Name), ("phone", input.Phone), ("password", passwordHash), ("enabled", input.Enabled), ("id", id)]);
                await Database.Execute(connection, transaction, "UPDATE Sessions SET RevokedAt=UTC_TIMESTAMP(6) WHERE UserId=@id", [("id", id)]);
            }
            await Database.Execute(connection, transaction, "DELETE FROM UserRoles WHERE UserId=@id", [("id", id)]);
            foreach (var role in input.Roles.Distinct())
            {
                await Database.Execute(connection, transaction, "INSERT INTO UserRoles VALUES(@id,@role)", [("id", id), ("role", role)]);
            }
            // 审计排除手机号、密码、哈希及微信凭证；只保留管理操作所需差异。
            await audit.Audit(connection, transaction, actor, previous is null ? "CREATE_USER" : "UPDATE_USER", "USER", id.Value, previous is null ? null : new { username = previous.Text("Username"), name = previous.Text("Name"), enabled = previous.Flag("Enabled"), roles = previousRoles }, new { input.Username, input.Name, input.Enabled, input.Roles, passwordChanged = input.Password is not null, phoneChanged = previous is not null && previous.Text("Phone") != input.Phone }, "", requestId);
            return new { id };
        });
    }
}
