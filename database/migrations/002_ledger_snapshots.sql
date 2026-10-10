-- 流水保留历史档案快照；档案改名不会重写历史报表名称。
ALTER TABLE InventoryLedger ADD COLUMN ItemName VARCHAR(100) NOT NULL DEFAULT '', ADD COLUMN Unit VARCHAR(16) NOT NULL DEFAULT '', ADD COLUMN Specification VARCHAR(200) NOT NULL DEFAULT '';
UPDATE InventoryLedger l JOIN Archives a ON a.Id=l.ItemId SET l.ItemName=a.Name,l.Unit=a.Unit,l.Specification=a.Specification;
