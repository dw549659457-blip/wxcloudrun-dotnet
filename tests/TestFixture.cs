using aspnetapp.Configuration;
using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Integrations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using MySqlConnector;
using Xunit;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

[assembly: CollectionBehavior(DisableTestParallelization = true)]
namespace Business.Tests;

/// <summary>每轮创建独立随机测试库；真实 MySQL、独立连接，绝不触碰开发或生产库。</summary>
public sealed class TestFixture : IAsyncLifetime
{
    public Database Database { get; private set; } = null!;
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public string DatabaseName { get; } = "vegetable_test_" + Guid.NewGuid().ToString("N");
    private readonly string password = aspnetapp.Services.PasswordService.Token();
    private string serverConnection = "";
    public Dictionary<string, HttpClient> Clients { get; } = [];
    public long Grower { get; private set; }
    public long Grower2 { get; private set; }
    public long Customer { get; private set; }
    public async Task InitializeAsync()
    {
        var testHost = Environment.GetEnvironmentVariable("TEST_MYSQL_HOST") ?? "127.0.0.1";
        var remote = testHost != "127.0.0.1" && testHost != "localhost" && testHost != "::1";
        if (remote && Environment.GetEnvironmentVariable("TEST_MYSQL_ALLOW_REMOTE") != "true")
        {
            throw new InvalidOperationException("远程测试需显式 TEST_MYSQL_ALLOW_REMOTE=true；测试仅创建/删除 vegetable_test_ 随机隔离库");
        }

        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development");
        Environment.SetEnvironmentVariable("DEV_LOGIN_ENABLED", "true");
        Environment.SetEnvironmentVariable("MYSQL_DATABASE", DatabaseName);
        Environment.SetEnvironmentVariable("MYSQL_HOST", testHost);
        Environment.SetEnvironmentVariable("MYSQL_PORT", Environment.GetEnvironmentVariable("TEST_MYSQL_PORT") ?? "3306");
        Environment.SetEnvironmentVariable("MYSQL_USER", Environment.GetEnvironmentVariable("TEST_MYSQL_USER") ?? "root");
        Environment.SetEnvironmentVariable("MYSQL_PASSWORD", Environment.GetEnvironmentVariable("TEST_MYSQL_PASSWORD") ?? "");
        Environment.SetEnvironmentVariable("MYSQL_SSL_MODE", Environment.GetEnvironmentVariable("TEST_MYSQL_SSL_MODE") ?? (remote ? "Required" : "Preferred"));
        Environment.SetEnvironmentVariable("MYSQL_SSL_CA_FILE", Environment.GetEnvironmentVariable("TEST_MYSQL_SSL_CA_FILE") ?? "");
        Environment.SetEnvironmentVariable("MYSQL_ADDRESS", null);
        Environment.SetEnvironmentVariable("MYSQL_USERNAME", null);
        Environment.SetEnvironmentVariable("APP_COMMAND", null);
        Environment.SetEnvironmentVariable("DEV_SEED_PASSWORD", password);
        var settings = AppSettings.Load();
        var builder = new MySqlConnectionStringBuilder(settings.ConnectionString) { Database = "" };
        serverConnection = builder.ConnectionString;
        await using (var server = new MySqlConnection(serverConnection))
        {
            await server.OpenAsync();
            // 数据库名由程序自身生成，仅允许固定前缀和十六进制，不接受外部传入标识符。
            await aspnetapp.Infrastructure.Database.Execute(server, null, $"CREATE DATABASE `{DatabaseName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }
        Database = new Database(settings);
        await new MigrationRunner(Database).Run();
        await new MigrationRunner(Database).Run(); // 重复运行不改变已执行迁移。
        await new Initialization(Database, settings).Seed();
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
        {
            host.UseEnvironment("Development");
            host.ConfigureServices(services => { services.RemoveAll<IWechatGateway>(); services.AddSingleton<IWechatGateway, FakeWechat>(); });
        });
        foreach (var user in new[] { "admin", "driver1", "driver2", "worker1", "worker2", "outbound1" })
        {
            var client = Factory.CreateClient();
            var login = await Send(client, HttpMethod.Post, "/api/auth/dev-login", new LoginInput(user, password));
            login.EnsureSuccessStatusCode();
            var data = await Json(login);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", data.GetProperty("token").GetString());
            Clients.Add(user, client);
        }
        await using var connection = await Database.Open();
        var growers = await aspnetapp.Infrastructure.Database.Query(connection, null, "SELECT Id FROM Archives WHERE Kind='GROWER' ORDER BY Id");
        Grower = growers[0].Id("Id"); Grower2 = growers[1].Id("Id");
        Customer = (await aspnetapp.Infrastructure.Database.Query(connection, null, "SELECT Id FROM Archives WHERE Kind='CUSTOMER' ORDER BY Id LIMIT 1"))[0].Id("Id");
    }
    public async Task DisposeAsync()
    {
        foreach (var client in Clients.Values)
        {
            client.Dispose();
        }

        if (Factory is not null)
        {
            await Factory.DisposeAsync();
        }
        MySqlConnection.ClearAllPools();
        if (serverConnection.Length == 0)
        {
            return;
        }

        await using var server = new MySqlConnection(serverConnection); await server.OpenAsync();
        await aspnetapp.Infrastructure.Database.Execute(server, null, $"DROP DATABASE IF EXISTS `{DatabaseName}`");
    }
    public static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object? input = null, string? key = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("Idempotency-Key", key ?? Guid.NewGuid().ToString("N"));
        if (input is not null)
        {
            request.Content = new StringContent(JsonSettings.Serialize(input), Encoding.UTF8, "application/json");
        }

        return await client.SendAsync(request);
    }
    public static async Task<JsonElement> Json(HttpResponseMessage response) => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    public async Task<long> Archive(string kind, string unit, string? name = null)
    {
        var response = await Send(Clients["admin"], HttpMethod.Post, $"/api/{kind}", new ArchiveInput(name ?? Guid.NewGuid().ToString("N"), unit));
        response.EnsureSuccessStatusCode(); return (await Json(response)).GetProperty("id").GetInt64();
    }
    public async Task<long> Create(string user, string kind, DocumentInput input, string? key = null, bool post = true)
    {
        var response = await Send(Clients[user], HttpMethod.Post, $"/api/{kind}", new DraftInput(input, post), key);
        if (!response.IsSuccessStatusCode)
        {
            throw new Xunit.Sdk.XunitException(await response.Content.ReadAsStringAsync());
        }

        return (await Json(response)).GetProperty("id").GetInt64();
    }
    public async Task<(long Packaging, long Vegetable)> Stock(decimal packaging = 1000, decimal vegetables = 0, string unit = "箱")
    {
        var packagingId = await Archive("packaging-types", "个"); var vegetableId = await Archive("vegetable-types", unit);
        var lines = new List<QuantityLine>();
        if (packaging > 0)
        {
            lines.Add(new(packagingId, packaging));
        }

        if (vegetables > 0)
        {
            lines.Add(new(vegetableId, vegetables));
        }

        if (lines.Count > 0)
        {
            await Create("admin", "stock-documents", new(new DateOnly(2026, 9, 30), lines.ToArray()));
        }

        return (packagingId, vegetableId);
    }
    public async Task<decimal> Balance(long item)
    {
        await using var connection = await Database.Open();
        return (await aspnetapp.Infrastructure.Database.Query(connection, null, "SELECT Quantity FROM InventoryBalances WHERE ItemId=@item", ("item", item)))[0].Quantity("Quantity");
    }
    public async Task<long> Batch(long dispatch, long? grower = null)
    {
        await using var connection = await Database.Open();
        return (await aspnetapp.Infrastructure.Database.Query(connection, null, "SELECT Id FROM WorkBatches WHERE DispatchId=@dispatch AND GrowerId=@grower", ("dispatch", dispatch), ("grower", grower ?? Grower)))[0].Id("Id");
    }
    public async Task<long> Dispatch(long packaging, decimal quantity = 100, long? grower = null)
    {
        var id = await Create("driver1", "dispatches", new(new(2026, 9, 30), [new(packaging, quantity, grower ?? Grower)]));
        return await Batch(id, grower);
    }
}

public sealed class FakeWechat : IWechatGateway
{
    public Task<(string AppId, string OpenId)> Identity(string code) => Task.FromResult(("test-app", code));
    public Task<string> Phone(string code) => Task.FromResult(code);
}
