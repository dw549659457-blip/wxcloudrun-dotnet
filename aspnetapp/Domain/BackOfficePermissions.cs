namespace aspnetapp.Domain;

public sealed record PermissionDefinition(string Key, string Module, string Label, bool DefaultGranted);
public sealed record PermissionPolicyInput(int Version, string[] Permissions, string Reason);

public static class BackOfficePermissions
{
    public static readonly PermissionDefinition[] Catalog =
    [
        new("archives.read", "基础档案", "查询", true),
        new("archives.export", "基础档案", "导出", true),
        new("archives.write", "基础档案", "新增、修改和停用", false),
        new("users.read", "员工资料", "查询", true),
        new("users.export", "员工资料", "导出", true),
        new("inventory.read", "库存", "查询", true),
        new("inventory.export", "库存", "导出", true),
        new("batches.read", "业务批次", "查询", true),
        new("batches.export", "业务批次", "导出", true),
        new("documents.read", "业务单据", "查询", true),
        new("documents.export", "业务单据", "导出", true),
        new("documents.create", "业务单据", "新增草稿", false),
        new("documents.edit", "业务单据", "修改草稿", false),
        new("documents.delete", "业务单据", "删除草稿", false),
        new("documents.post", "业务单据", "提交入账", false),
        new("documents.reverse", "业务单据", "冲销已入账单据", false),
        new("documents.correct", "业务单据", "修正已入账单据", false),
        new("reports.read", "台账报表", "查询", true),
        new("reports.export", "台账报表", "导出", true),
        new("reconcile.read", "库存对账", "只读对账", true)
    ];
    public static string[] All => Catalog.Select(entry => entry.Key).ToArray();
}
