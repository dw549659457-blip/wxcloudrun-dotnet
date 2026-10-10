using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Services;

namespace aspnetapp.Infrastructure;

public sealed class Initialization(Database database, AppSettings settings)
{
    public async Task Admin()
    {
        var username = Environment.GetEnvironmentVariable("INITIAL_ADMIN_USERNAME") ?? throw new InvalidOperationException("缺少 INITIAL_ADMIN_USERNAME");
        var password = Environment.GetEnvironmentVariable("INITIAL_ADMIN_PASSWORD") ?? throw new InvalidOperationException("通过环境变量安全设置初始管理员密码");
        if (password.Length is < 12 or > 128)
        {
            throw new InvalidOperationException("管理员密码需 12—128 字符");
        }

        await using var connection = await database.Open();
        await using var transaction = await connection.BeginTransactionAsync();
        try
        {
            var users = await Database.Query(connection, transaction, "SELECT Id FROM Users WHERE Username=@username FOR UPDATE", ("username", username));
            if (users.Count > 0)
            {
                throw new InvalidOperationException("管理员账号已存在，不覆盖现有密码");
            }

            var id = await Database.Insert(connection, transaction, "INSERT INTO Users(Username,Name,PasswordHash,Enabled,CreatedAt) VALUES(@username,'管理员',@hash,TRUE,UTC_TIMESTAMP(6))", ("username", username), ("hash", PasswordService.Hash(password)));
            await Database.Execute(connection, transaction, "INSERT INTO UserRoles VALUES(@id,'ADMIN')", [("id", id)]);
            await transaction.CommitAsync();
            Console.WriteLine("初始管理员创建成功，密码未输出");
        }
        catch { await transaction.RollbackAsync(); throw; }
    }
    public async Task Seed()
    {
        if (settings.Production)
        {
            throw new InvalidOperationException("生产禁止运行开发种子");
        }

        var password = Environment.GetEnvironmentVariable("DEV_SEED_PASSWORD") ?? throw new InvalidOperationException("请显式设置 DEV_SEED_PASSWORD，至少 12 字符");
        if (password.Length is < 12 or > 128)
        {
            throw new InvalidOperationException("开发密码需 12—128 字符");
        }

        await using var connection = await database.Open();
        await using var transaction = await connection.BeginTransactionAsync();
        try
        {
            var accounts = new[] { ("admin", "管理员", Roles.Admin), ("driver1", "司机一", Roles.Driver), ("driver2", "司机二", Roles.Driver), ("worker1", "女工一", Roles.Worker), ("worker2", "女工二", Roles.Worker), ("outbound1", "出库员", Roles.Outbound) };
            for (var index = 0; index < accounts.Length; index++)
            {
                var account = accounts[index];
                var previous = await Database.Query(connection, transaction, "SELECT Id FROM Users WHERE Username=@username", ("username", account.Item1));
                if (previous.Count != 0)
                {
                    continue;
                }

                var id = await Database.Insert(connection, transaction, "INSERT INTO Users(Username,Name,Phone,PasswordHash,CreatedAt) VALUES(@username,@name,@phone,@hash,UTC_TIMESTAMP(6))", ("username", account.Item1), ("name", account.Item2), ("phone", "1380000000" + index), ("hash", PasswordService.Hash(password)));
                await Database.Execute(connection, transaction, "INSERT INTO UserRoles VALUES(@id,@role)", [("id", id), ("role", account.Item3)]);
            }
            var archives = new[] { ("GROWER", "棚户A", ""), ("GROWER", "棚户B", ""), ("CUSTOMER", "客户A", ""), ("CUSTOMER", "客户B", ""), ("PACKAGING", "泡沫箱", "个"), ("PACKAGING", "网袋", "个"), ("VEGETABLE", "白菜", "箱"), ("VEGETABLE", "番茄", "公斤") };
            foreach (var archive in archives)
            {
                var previous = await Database.Query(connection, transaction, "SELECT Id FROM Archives WHERE Kind=@kind AND Name=@name", ("kind", archive.Item1), ("name", archive.Item2));
                if (previous.Count != 0)
                {
                    continue;
                }

                var id = await Database.Insert(connection, transaction, "INSERT INTO Archives(Kind,Name,Unit) VALUES(@kind,@name,@unit)", ("kind", archive.Item1), ("name", archive.Item2), ("unit", archive.Item3));
                if (archive.Item1 is "PACKAGING" or "VEGETABLE")
                {
                    await Database.Execute(connection, transaction, "INSERT INTO InventoryBalances(ItemId) VALUES(@id)", [("id", id)]);
                }
            }
            await transaction.CommitAsync();
            Console.WriteLine("开发档案与 6 个角色账号准备完成；不改变已有库存，新品类初始为零，密码由 DEV_SEED_PASSWORD 提供");
        }
        catch { await transaction.RollbackAsync(); throw; }
    }
}
