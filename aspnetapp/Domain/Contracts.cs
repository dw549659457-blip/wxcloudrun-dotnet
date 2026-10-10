using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace aspnetapp.Domain;

public static class Roles
{
    public const string Admin = "ADMIN";
    public const string Driver = "DRIVER";
    public const string Worker = "WORKER";
    public const string Outbound = "OUTBOUND";
    public static readonly string[] All = [Admin, Driver, Worker, Outbound];
}

public sealed class BusinessException(int status, string code, string message, object? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Details { get; } = details;
    public static BusinessException Invalid(string message) => new(400, "VALIDATION_FAILED", message);
    public static BusinessException Conflict(string code, string message, object? details = null) => new(409, code, message, details);
}

public sealed record Actor(long Id, string Name, string[] Roles, string SessionType, string TokenHash, string? SelectedRole = null)
{
    public bool IsAdmin => Roles.Contains(Domain.Roles.Admin);
    public void Require(params string[] allowed)
    {
        if (!IsAdmin && !Roles.Any(allowed.Contains))
        {
            throw new BusinessException(403, "FORBIDDEN", "您没有此操作权限");
        }
    }
}

public sealed record RoleSelectionInput(string Role);
public sealed record LoginInput(string Username, string Password);
public sealed record WechatLoginInput(string Code);
public sealed record PhoneBindingInput(string BindingToken, string PhoneCode);
public sealed record BindingTokenInput(string BindingToken);
public sealed record BindingDecisionInput(long UserId, string Reason);
public sealed record UserInput(string Username, string Name, string Phone, string[] Roles, bool Enabled = true, string? Password = null);
public sealed record ArchiveInput(string Name, string Unit = "", string Specification = "", string Contact = "", string Phone = "", bool Enabled = true);
public sealed record QuantityLine(long ItemId, decimal Quantity, long? GrowerId = null, string Direction = "IN");
public sealed record DocumentInput(
    DateOnly BusinessDate, QuantityLine[] Items, long? BatchId = null, long? CustomerId = null,
    QuantityLine[]? Vegetables = null, string Mode = "NORMAL", string Source = "OPENING", string Remark = "",
    bool ConfirmFinal = false, string LossReason = "", string DifferenceReason = "");
public sealed record DraftInput(DocumentInput Document, bool Post = false);
public sealed record PostInput(int Version);
public sealed record ReverseInput(string Reason);
public sealed record CorrectInput(string Reason, DocumentInput Document);
public sealed record DisplayLine(long ItemId, decimal ActualQuantity, decimal DisplayQuantity);
public sealed record DocumentRecord(long Id, string Number, string Kind, long CreatorId, string Status, int Version, DocumentInput Input, long? ReplacesId, string CreatorName = "", DateTime? CreatedAt = null, DateTime? PostedAt = null, string? CustomerName = null)
{
    // 列表与详情均提供明确的展示量，DIRECT负号绝不影响实际扣库存口径。
    public DisplayLine[] DisplayItems => Input.Items.Select(line => new DisplayLine(
        line.ItemId, line.Quantity, Kind == DocumentKinds.Outbound && Input.Mode == OutboundModes.Direct ? -line.Quantity : line.Quantity)).ToArray();
}
public sealed record DocumentPage(DocumentRecord[] Items, int Page, int PageSize);
public sealed record SubmissionResult(long Id, string Number, string Status, int Version);
public sealed record PageQuery(int Page = 1, int PageSize = 20, DateOnly? From = null, DateOnly? To = null, string Sort = "desc", long? ItemId = null, long? GrowerId = null, long? DriverId = null, string? Source = null, string? Search = null);

/// <summary>API 数量只接收十进制字符串；C# decimal 与 MySQL DECIMAL 避免浮点库存误差。</summary>
public sealed class DecimalStringConverter : JsonConverter<decimal>
{
    public override decimal Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String || !System.Text.RegularExpressions.Regex.IsMatch(reader.GetString() ?? "", @"^-?[0-9]{1,15}(\.[0-9]{1,3})?$") || !decimal.TryParse(reader.GetString(), NumberStyles.AllowDecimalPoint | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value))
        {
            throw new JsonException("数量必须是精确十进制字符串，例如 \"12.500\"");
        }
        return value;
    }
    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString(CultureInfo.InvariantCulture));
}

public static class JsonSettings
{
    public static readonly JsonSerializerOptions Options = Create();
    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
        options.Converters.Add(new DecimalStringConverter());
        return options;
    }
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options) ?? throw new InvalidOperationException("数据不完整");
}
