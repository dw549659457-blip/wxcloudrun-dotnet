using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using MySqlConnector;

namespace aspnetapp.Services;

public static class PersonnelManagement
{
    public static void RequireScope(Actor actor, string[] targetRoles)
    {
        actor.RequirePersonnelManagement();
        if (!actor.IsAdmin && Roles.BackOffice(targetRoles))
            throw new BusinessException(403, "FORBIDDEN", "后台管理员只能维护下级员工，同级和上级账号由管理员维护");
    }
    public static void RequirePasswordAuthority(Actor actor, string? password)
    {
        if (!actor.IsAdmin && password is not null)
            throw new BusinessException(403, "FORBIDDEN", "后台密码由管理员维护");
    }
    // 在已有串行事务内重新读取操作者，防止等待事务期间角色被降级或账号停用。
    public static async Task<Actor> RequireCurrent(MySqlConnection connection, MySqlTransaction transaction, Actor actor, params string[][] affectedRoles)
    {
        var users = await Database.Query(connection, transaction, "SELECT Enabled FROM Users WHERE Id=@id FOR UPDATE", ("id", actor.Id));
        if (users.Count == 0 || !users[0].Flag("Enabled"))
            throw new BusinessException(403, "FORBIDDEN", "当前账号已停用或权限已改变");
        var current = actor with { Roles = await AuthService.UserRoles(connection, transaction, actor.Id) };
        current.RequirePersonnelManagement();
        foreach (var roles in affectedRoles) RequireScope(current, roles);
        return current;
    }
}
