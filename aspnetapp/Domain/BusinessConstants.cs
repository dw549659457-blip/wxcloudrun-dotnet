namespace aspnetapp.Domain;

// 状态、模式和库存域集中定义；SQL 迁移中的枚举字面值须与这些值保持一致。
public static class DocumentKinds
{
    public const string Dispatch = "DISPATCH";
    public const string Work = "WORK";
    public const string Recovery = "RECOVERY";
    public const string Outbound = "OUTBOUND";
    public const string Stock = "STOCK";
}

public static class DocumentStatuses
{
    public const string Draft = "DRAFT";
    public const string Posted = "POSTED";
    public const string Reversed = "REVERSED";
}

public static class BatchStatuses
{
    public const string Open = "OPEN";
    public const string Closed = "CLOSED";
}

public static class RecoveryModes
{
    public const string Partial = "PARTIAL";
    public const string Final = "FINAL";
}

public static class OutboundModes
{
    public const string Normal = "NORMAL";
    public const string Direct = "DIRECT";
}

public static class InventoryDomains
{
    public const string WarehousePackaging = "WAREHOUSE_PACKAGING";
    public const string ExternalPackaging = "EXTERNAL_PACKAGING";
    public const string Vegetable = "VEGETABLE";
}

public static class StockSources
{
    public const string Opening = "OPENING";
    public const string Replenishment = "REPLENISHMENT";
    public const string External = "EXTERNAL";
    public const string Adjustment = "ADJUSTMENT";
}

public static class ArchiveKinds
{
    public const string Grower = "GROWER";
    public const string Packaging = "PACKAGING";
    public const string Customer = "CUSTOMER";
}

public static class SessionTypes
{
    public const string WebAdmin = "WEB_ADMIN";
    public const string Miniprogram = "MINIPROGRAM";
}

public static class BindingStatuses
{
    public const string PendingPhone = "PENDING_PHONE";
    public const string PendingConfirm = "PENDING_CONFIRM";
    public const string PendingApproval = "PENDING_APPROVAL";
    public const string Approved = "APPROVED";
    public const string Rejected = "REJECTED";
    public const string Consumed = "CONSUMED";
    public const string Revoked = "REVOKED";
}
