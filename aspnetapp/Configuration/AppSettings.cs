using MySqlConnector;

namespace aspnetapp.Configuration;

public sealed record AppSettings(string ConnectionString, int Port, bool Production, bool DevelopmentLogin, string TimeZone, int RequestTimeoutSeconds, string? AppId, string? AppSecret, string TokenMode, string[] TrustedProxies)
{
    public static AppSettings Load()
    {
        string? Read(string name) => Environment.GetEnvironmentVariable(name);
        int Integer(string name, int fallback)
        {
            var text = Read(name);
            if (text is null)
            {
                return fallback;
            }

            if (!int.TryParse(text, out var value) || value < 1)
            {
                throw new InvalidOperationException($"{name} 必须为正整数");
            }

            return value;
        }
        var production = !string.Equals(Read("ASPNETCORE_ENVIRONMENT") ?? "Production", "Development", StringComparison.OrdinalIgnoreCase);
        var developmentLogin = Read("DEV_LOGIN_ENABLED") == "true";
        if (production && developmentLogin)
        {
            throw new InvalidOperationException("生产环境禁止启用开发登录");
        }
        var legacy = Read("MYSQL_ADDRESS")?.Split(':');
        if (legacy is { Length: not 2 })
        {
            throw new InvalidOperationException("MYSQL_ADDRESS 必须为 host:port");
        }

        var host = Read("MYSQL_HOST") ?? legacy?[0] ?? "127.0.0.1";
        var port = Integer("MYSQL_PORT", legacy is null ? 3306 : int.Parse(legacy[1]));
        if (string.IsNullOrWhiteSpace(host) || port > 65535)
        {
            throw new InvalidOperationException("MySQL 地址或端口无效");
        }

        if (Integer("MYSQL_POOL_LIMIT", 10) > 200 || Integer("REQUEST_TIMEOUT_SECONDS", 30) > 300 || Integer("PORT", 80) > 65535)
        {
            throw new InvalidOperationException("连接池、超时或监听端口超出配置范围");
        }

        var username = Read("MYSQL_USER") ?? Read("MYSQL_USERNAME") ?? "";
        if (legacy is not null && (host != legacy[0] || port != int.Parse(legacy[1])))
        {
            throw new InvalidOperationException("新旧 MySQL 地址配置冲突");
        }

        if (Read("MYSQL_USER") is { } modern && Read("MYSQL_USERNAME") is { } old && modern != old)
        {
            throw new InvalidOperationException("新旧 MySQL 用户名冲突");
        }

        var database = Read("MYSQL_DATABASE") ?? throw new InvalidOperationException("请明确设置独立业务库 MYSQL_DATABASE，不使用计数器示例库");
        var command = Read("APP_COMMAND");
        if (production && string.Equals(username, "root", StringComparison.OrdinalIgnoreCase)
            && Read("MYSQL_ALLOW_ROOT") != "true" && command != "migrate" && command != "init-admin")
        {
            throw new InvalidOperationException("生产应用默认使用专用业务数据库账号；明确使用托管 root 时设置 MYSQL_ALLOW_ROOT=true");
        }

        var connection = new MySqlConnectionStringBuilder
        {
            Server = host,
            Port = (uint)port,
            Database = database,
            UserID = username,
            Password = Read("MYSQL_PASSWORD") ?? "",
            MaximumPoolSize = (uint)Integer("MYSQL_POOL_LIMIT", 10),
            ConnectionTimeout = 10,
            DefaultCommandTimeout = 30,
            AllowUserVariables = true,
            SslMode = Enum.Parse<MySqlSslMode>(Read("MYSQL_SSL_MODE") ?? "Preferred", true),
            SslCa = Read("MYSQL_SSL_CA_FILE") ?? ""
        };
        var timezone = Read("BUSINESS_TIME_ZONE") ?? "Asia/Shanghai";
        TimeZoneInfo.FindSystemTimeZoneById(timezone);
        var mode = Read("WECHAT_TOKEN_MODE") ?? "standard";
        if (mode != "standard")
        {
            throw new InvalidOperationException("本版使用微信标准 access_token 适配器；平台托管令牌尚未验证");
        }

        return new(connection.ConnectionString, Integer("PORT", 80), production, developmentLogin, timezone,
            Integer("REQUEST_TIMEOUT_SECONDS", 30), Read("WECHAT_APP_ID"), Read("WECHAT_APP_SECRET"), mode,
            (Read("TRUSTED_PROXIES") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    }
}
