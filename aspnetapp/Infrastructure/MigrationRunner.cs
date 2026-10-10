using System.Security.Cryptography;
using System.Text;
using aspnetapp.Configuration;
using MySqlConnector;

namespace aspnetapp.Infrastructure;

public sealed class MigrationRunner(Database database)
{
    public async Task Run()
    {
        await using var connection = await database.Open();
        await using var acquire = Database.Command(connection, null, "SELECT GET_LOCK('vegetable_business_migrations',10)");
        if (Convert.ToInt32(await acquire.ExecuteScalarAsync()) != 1)
        {
            throw new InvalidOperationException("其他迁移正在运行");
        }

        try
        {
            await Database.Execute(connection, null, "CREATE TABLE IF NOT EXISTS SchemaMigrations (Name VARCHAR(200) PRIMARY KEY, Checksum CHAR(64) NOT NULL, AppliedAt DATETIME(6) NOT NULL) ENGINE=InnoDB");
            var path = Path.Combine(AppContext.BaseDirectory, "migrations");
            foreach (var file in Directory.GetFiles(path, "*.sql").Order(StringComparer.Ordinal))
            {
                var sql = await File.ReadAllTextAsync(file);
                var name = Path.GetFileName(file);
                var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));
                var previous = await Database.Query(connection, null, "SELECT Checksum FROM SchemaMigrations WHERE Name=@name", ("name", name));
                if (previous.Count != 0)
                {
                    if (previous[0].Text("Checksum") != checksum)
                    {
                        throw new InvalidOperationException($"已执行迁移 {name} 校验值改变，禁止覆盖历史");
                    }

                    continue;
                }
                // MySQL DDL 不具备事务回滚能力；失败须检查部分结构，不能假报整份迁移已完成。
                await Database.Execute(connection, null, sql);
                await Database.Execute(connection, null, "INSERT INTO SchemaMigrations VALUES (@name,@checksum,UTC_TIMESTAMP(6))", [("name", name), ("checksum", checksum)]);
                Console.WriteLine($"迁移完成：{name}");
            }
        }
        finally
        {
            await Database.Execute(connection, null, "DO RELEASE_LOCK('vegetable_business_migrations')");
        }
    }
}
