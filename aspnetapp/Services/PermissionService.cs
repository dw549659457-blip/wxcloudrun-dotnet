using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Repositories;
using MySqlConnector;

namespace aspnetapp.Services;

public sealed class PermissionService(Database database, TransactionService transactions, DocumentRepository audit)
{
    public static async Task<string[]> Effective(MySqlConnection connection, MySqlTransaction? transaction, string[] roles)
    {
        if (roles.Contains(Roles.Admin)) return BackOfficePermissions.All;
        if (!roles.Contains(Roles.Accountant)) return [];
        var rows = await Database.Query(connection, transaction,
            "SELECT PermissionKey FROM BackOfficeRolePermissions WHERE Role='ACCOUNTANT' ORDER BY PermissionKey");
        return rows.Select(row => row.Text("PermissionKey")).Concat(BackOfficePermissions.Fixed).Distinct().Order(StringComparer.Ordinal).ToArray();
    }
    public async Task<object> Read(Actor actor)
    {
        actor.Require(Roles.Admin);
        await using var connection = await database.Open();
        var policy = (await Database.Query(connection, null, "SELECT * FROM BackOfficeRolePolicies WHERE Role='ACCOUNTANT'"))[0];
        return new { role = Roles.Accountant, version = policy.Id("Version"), catalog = BackOfficePermissions.Catalog,
            permissions = await Effective(connection, null, [Roles.Accountant]) };
    }
    public Task<object> Save(Actor actor, PermissionPolicyInput input, string requestId)
    {
        actor.Require(Roles.Admin);
        if (input.Permissions is null || input.Permissions.Any(key => !BackOfficePermissions.All.Contains(key))
            || string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 500)
            throw BusinessException.Invalid("请选择有效权限并填写调整原因");
        var permissions = input.Permissions.Concat(BackOfficePermissions.Fixed).Distinct().Order(StringComparer.Ordinal).ToArray();
        foreach (var key in permissions.Where(key => !key.EndsWith(".read", StringComparison.Ordinal)))
            if (!permissions.Contains(key.Split('.')[0] + ".read"))
                throw BusinessException.Invalid("导出或业务操作权限必须同时保留对应查询权限");
        return transactions.Run<object>(async (connection, transaction) =>
        {
            var policy = (await Database.Query(connection, transaction,
                "SELECT Version FROM BackOfficeRolePolicies WHERE Role='ACCOUNTANT' FOR UPDATE"))[0];
            if (policy.Id("Version") != input.Version)
                throw BusinessException.Conflict("VERSION_CONFLICT", "权限已被其他管理员调整，请刷新后再保存");
            var previous = await Effective(connection, transaction, [Roles.Accountant]);
            await Database.Execute(connection, transaction, "DELETE FROM BackOfficeRolePermissions WHERE Role='ACCOUNTANT'");
            foreach (var permission in permissions)
                await Database.Execute(connection, transaction,
                    "INSERT INTO BackOfficeRolePermissions VALUES('ACCOUNTANT',@key)", [("key", permission)]);
            await Database.Execute(connection, transaction,
                "UPDATE BackOfficeRolePolicies SET Version=Version+1,UpdatedAt=UTC_TIMESTAMP(6) WHERE Role='ACCOUNTANT'");
            await audit.Audit(connection, transaction, actor, "CONFIGURE_PERMISSIONS", "ROLE", 0,
                new { role = Roles.Accountant, permissions = previous }, new { role = Roles.Accountant, permissions }, input.Reason, requestId);
            return new { role = Roles.Accountant, version = input.Version + 1, permissions };
        });
    }
}
