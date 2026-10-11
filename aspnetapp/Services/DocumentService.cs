using aspnetapp.Domain;
using aspnetapp.Infrastructure;
using aspnetapp.Repositories;
using MySqlConnector;

namespace aspnetapp.Services;

/// <summary>业务单据生命周期；库存入账仅发生在 POSTED，草稿不影响任何余额。</summary>
public sealed class DocumentService(TransactionService transactions, DocumentRepository documents, InventoryRepository inventory)
{
    public static void Authorize(Actor actor, string kind, string action = "read")
    {
        if (kind is not (DocumentKinds.Dispatch or DocumentKinds.Recovery or DocumentKinds.Work or DocumentKinds.Outbound or DocumentKinds.Stock))
            throw new BusinessException(404, "NOT_FOUND", "未知单据类型");
        if (actor.IsBackOffice)
        {
            actor.RequirePermission("documents." + action);
            return;
        }
        switch (kind)
        {
            case DocumentKinds.Dispatch: case DocumentKinds.Recovery: actor.Require(Roles.Driver); break;
            case DocumentKinds.Work: actor.Require(Roles.Worker); break;
            case DocumentKinds.Outbound: actor.Require(Roles.Outbound); break;
            case DocumentKinds.Stock: actor.Require(Roles.Admin); break;
            default: throw new BusinessException(404, "NOT_FOUND", "未知单据类型");
        }
    }
    public static void Own(Actor actor, DocumentRecord document, string action = "read")
    {
        Authorize(actor, document.Kind, action);
        if (!actor.IsBackOffice && actor.Id != document.CreatorId)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到单据");
        }
    }
    public static void Validate(DocumentInput input, string kind)
    {
        if (input.BusinessDate.Year < 2000 || input.BusinessDate.Year > 2100)
        {
            throw BusinessException.Invalid("业务日期须为 2000—2100 年内有效日期");
        }

        if (input.Items is null || input.Items.Length > 200 || (input.Vegetables?.Length ?? 0) > 200)
        {
            throw BusinessException.Invalid("单据最多 200 行明细");
        }

        if (input.Remark.Length > 500 || input.LossReason.Length > 500 || input.DifferenceReason.Length > 500)
        {
            throw BusinessException.Invalid("备注/原因最多 500 字");
        }

        if (kind is DocumentKinds.Dispatch or DocumentKinds.Outbound or DocumentKinds.Stock or DocumentKinds.Work && input.Items.Length == 0)
        {
            throw BusinessException.Invalid("不能提交空单");
        }

        if (kind == DocumentKinds.Work && (input.Vegetables?.Length ?? 0) == 0)
        {
            throw BusinessException.Invalid("装菜记录需要填写产出");
        }

        if (kind is DocumentKinds.Work or DocumentKinds.Recovery && input.BatchId is null)
        {
            throw BusinessException.Invalid("必须选择关联下发批次");
        }

        if (kind == DocumentKinds.Recovery && input.Mode is not (RecoveryModes.Partial or RecoveryModes.Final))
        {
            throw BusinessException.Invalid("必须明确选择部分回收或最终回收");
        }

        if (kind == DocumentKinds.Recovery && input.Mode == RecoveryModes.Partial && input.Items.Length == 0 && (input.Vegetables?.Length ?? 0) == 0)
        {
            throw BusinessException.Invalid("部分回收不能提交空单");
        }

        if (kind == DocumentKinds.Outbound && (input.Mode is not (OutboundModes.Normal or OutboundModes.Direct) || input.CustomerId is null))
        {
            throw BusinessException.Invalid("出库需要客户与有效模式");
        }

        if (kind == DocumentKinds.Outbound && input.Mode == OutboundModes.Direct && string.IsNullOrWhiteSpace(input.Remark))
        {
            throw BusinessException.Invalid("手工直接出库必须说明来源");
        }

        if (kind == DocumentKinds.Stock && input.Source is not (StockSources.Opening or StockSources.Replenishment or StockSources.External or StockSources.Adjustment))
        {
            throw BusinessException.Invalid("无效库存来源");
        }

        if (kind == DocumentKinds.Stock && input.Source == StockSources.Adjustment && string.IsNullOrWhiteSpace(input.Remark))
        {
            throw BusinessException.Invalid("库存调整必须填写原因");
        }

        foreach (var line in input.Items.Concat(input.Vegetables ?? []))
        {
            InventoryRepository.ValidateQuantity(line.Quantity, "公斤");
            if (line.ItemId <= 0 || line.Direction is not ("IN" or "OUT"))
            {
                throw BusinessException.Invalid("明细档案/方向无效");
            }

            if (kind != DocumentKinds.Stock && line.Direction != "IN")
            {
                throw BusinessException.Invalid("业务数量必须为正，方向由服务端决定");
            }

            if (kind != DocumentKinds.Dispatch && line.GrowerId is not null)
            {
                throw BusinessException.Invalid("非下发明细不可自报棚户");
            }
        }
        if (kind == DocumentKinds.Dispatch && input.Items.Any(line => line.GrowerId is null))
        {
            throw BusinessException.Invalid("下发每行必须指定棚户");
        }

        if (kind is not (DocumentKinds.Work or DocumentKinds.Recovery) && input.Vegetables is { Length: > 0 })
        {
            throw BusinessException.Invalid("该单据不可附带产出/实收明细");
        }

        if (kind is not (DocumentKinds.Work or DocumentKinds.Recovery) && input.BatchId is not null)
        {
            throw BusinessException.Invalid("该单据不可关联作业批次");
        }
    }
    public Task<SubmissionResult> Create(Actor actor, string kind, DraftInput request, string key, string requestId)
    {
        Authorize(actor, kind, "create");
        if (request.Post) Authorize(actor, kind, "post");
        Validate(request.Document, kind);
        return transactions.Idempotent(actor, $"{kind}:create", key, request, async (connection, transaction) =>
        {
            var document = await documents.Create(connection, transaction, kind, actor.Id, request.Document);
            await documents.Audit(connection, transaction, actor, "CREATE_DRAFT", kind, document.Id, null, request.Document, "", requestId);
            if (request.Post)
            {
                return await PostCore(connection, transaction, actor, document, requestId);
            }

            return new(document.Id, document.Number, document.Status, document.Version);
        });
    }
    public Task<SubmissionResult> Post(Actor actor, long id, string kind, int version, string key, string requestId)
    {
        Authorize(actor, kind, "post");
        return transactions.Idempotent(actor, $"{kind}:{id}:post", key, new { version }, async (connection, transaction) =>
        {
            var document = await documents.Get(connection, transaction, id, true);
            Own(actor, document, "post");
            if (document.Kind != kind)
            {
                throw new BusinessException(404, "NOT_FOUND", "未找到单据");
            }

            if (document.Version != version)
            {
                throw BusinessException.Conflict("VERSION_CONFLICT", "草稿已改变，请刷新确认");
            }

            return await PostCore(connection, transaction, actor, document, requestId);
        });
    }
    public Task<SubmissionResult> Edit(Actor actor, long id, string kind, int version, DocumentInput input, string requestId = "") => transactions.Run(async (connection, transaction) =>
    {
        var document = await documents.Get(connection, transaction, id, true);
        Own(actor, document, "edit");
        if (document.Kind != kind)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到单据");
        }

        Validate(input, kind);
        if (document.Status != DocumentStatuses.Draft)
        {
            throw BusinessException.Conflict("POSTED_IMMUTABLE", "已提交单据需由管理员冲销和重建");
        }

        if (document.Version != version)
        {
            throw BusinessException.Conflict("VERSION_CONFLICT", "草稿已改变，请刷新");
        }

        await Database.Execute(connection, transaction, "UPDATE Documents SET Payload=@payload,BusinessDate=@date,Version=Version+1 WHERE Id=@id", [("payload", JsonSettings.Serialize(input)), ("date", input.BusinessDate.ToString("yyyy-MM-dd")), ("id", id)]);
        await documents.Audit(connection, transaction, actor, "EDIT_DRAFT", kind, id, document.Input, input, "", requestId);
        return new SubmissionResult(id, document.Number, DocumentStatuses.Draft, version + 1);
    });
    public Task Delete(Actor actor, long id, string kind, string requestId = "") => transactions.Run(async (connection, transaction) =>
    {
        var document = await documents.Get(connection, transaction, id, true);
        Own(actor, document, "delete");
        if (document.Kind != kind)
        {
            throw new BusinessException(404, "NOT_FOUND", "未找到单据");
        }

        if (document.Status != DocumentStatuses.Draft)
        {
            throw BusinessException.Conflict("POSTED_IMMUTABLE", "只能删除草稿");
        }
        await documents.Audit(connection, transaction, actor, "DELETE_DRAFT", kind, id, document.Input, new { status = DocumentStatuses.Reversed }, "", requestId);
        // 保留单号和幂等查询结果，将草稿标记冲销，不硬删除历史头表。
        await Database.Execute(connection, transaction, "UPDATE Documents SET Status='REVERSED',Version=Version+1 WHERE Id=@id", [("id", id)]);
        return true;
    });
    private static IEnumerable<QuantityLine> Merge(IEnumerable<QuantityLine> lines) => lines.GroupBy(line => (line.ItemId, line.GrowerId, line.Direction)).Select(group => new QuantityLine(group.Key.ItemId, group.Sum(line => line.Quantity), group.Key.GrowerId, group.Key.Direction)).OrderBy(line => line.ItemId).ThenBy(line => line.GrowerId);
    private async Task<SubmissionResult> PostCore(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document, string requestId)
    {
        if (document.Status != DocumentStatuses.Draft)
        {
            throw BusinessException.Conflict("ALREADY_POSTED", "单据已提交或已冲销");
        }

        Validate(document.Input, document.Kind);
        switch (document.Kind)
        {
            case DocumentKinds.Dispatch: await Dispatch(connection, transaction, actor, document); break;
            case DocumentKinds.Work: await Work(connection, transaction, actor, document); break;
            case DocumentKinds.Recovery: await Recover(connection, transaction, actor, document); break;
            case DocumentKinds.Outbound: await Outbound(connection, transaction, actor, document); break;
            case DocumentKinds.Stock: await Stock(connection, transaction, actor, document); break;
        }
        await Database.Execute(connection, transaction, "UPDATE Documents SET Status='POSTED',Version=Version+1,PostedAt=UTC_TIMESTAMP(6) WHERE Id=@id", [("id", document.Id)]);
        await documents.Audit(connection, transaction, actor, "POST", document.Kind, document.Id, null, document.Input, "", requestId);
        return new(document.Id, document.Number, DocumentStatuses.Posted, document.Version + 1);
    }
    private async Task Dispatch(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document)
    {
        foreach (var growerGroup in Merge(document.Input.Items).GroupBy(line => line.GrowerId!.Value).OrderBy(group => group.Key))
        {
            var grower = await inventory.Archive(connection, transaction, growerGroup.Key, ArchiveKinds.Grower);
            var batchId = await Database.Insert(connection, transaction, "INSERT INTO WorkBatches(DispatchId,GrowerId,DriverId,GrowerName) VALUES(@dispatch,@grower,@driver,@name)", ("dispatch", document.Id), ("grower", growerGroup.Key), ("driver", document.CreatorId), ("name", grower.Text("Name")));
            foreach (var line in growerGroup)
            {
                var archive = await inventory.Archive(connection, transaction, line.ItemId, ArchiveKinds.Packaging);
                InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
                await inventory.ChangeWarehouse(connection, transaction, line.ItemId, -line.Quantity, document.Id, actor.Id, InventoryDomains.WarehousePackaging, DocumentKinds.Dispatch, batchId);
                await Database.Execute(connection, transaction, "INSERT INTO BatchPackagingBalances(BatchId,ItemId,Dispatched,Outstanding) VALUES(@batch,@item,@quantity,@quantity)", [("batch", batchId), ("item", line.ItemId), ("quantity", line.Quantity)]);
                await inventory.Ledger(connection, transaction, InventoryDomains.ExternalPackaging, line.ItemId, batchId, line.Quantity, DocumentKinds.Dispatch, document.Id, actor.Id);
                await documents.AddLine(connection, transaction, document.Id, ArchiveKinds.Packaging, line, archive, batchId);
            }
        }
    }
    private async Task Work(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document)
    {
        var batchId = document.Input.BatchId!.Value;
        await inventory.Batch(connection, transaction, batchId, actor, true);
        await inventory.BatchDependencies(connection, transaction, batchId, document.Id);
        foreach (var line in Merge(document.Input.Items))
        {
            var archive = await inventory.Archive(connection, transaction, line.ItemId, ArchiveKinds.Packaging);
            InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
            var changed = await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances SET Consumed=Consumed+@quantity,Outstanding=Outstanding-@quantity,Version=Version+1 WHERE BatchId=@batch AND ItemId=@item AND Outstanding>=@quantity", [("batch", batchId), ("item", line.ItemId), ("quantity", line.Quantity)]);
            if (changed != 1)
            {
                throw BusinessException.Conflict("INSUFFICIENT_EXTERNAL_PACKAGING", "本批次可用包装不足，或此包装未下发");
            }
            // 消耗只扣在外包装，不再次扣仓库库存；产出也不直接入仓。
            await inventory.Ledger(connection, transaction, InventoryDomains.ExternalPackaging, line.ItemId, batchId, -line.Quantity, "CONSUMPTION", document.Id, actor.Id);
            await documents.AddLine(connection, transaction, document.Id, "CONSUMPTION", line, archive, batchId);
        }
        foreach (var line in Merge(document.Input.Vegetables!))
        {
            var archive = await inventory.Archive(connection, transaction, line.ItemId, InventoryDomains.Vegetable);
            InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
            await Database.Execute(connection, transaction, "INSERT INTO BatchVegetableBalances(BatchId,ItemId,Output,Received) VALUES(@batch,@item,@quantity,0) ON DUPLICATE KEY UPDATE Output=Output+@quantity", [("batch", batchId), ("item", line.ItemId), ("quantity", line.Quantity)]);
            await documents.AddLine(connection, transaction, document.Id, "OUTPUT", line, archive, batchId);
        }
        await Database.Execute(connection, transaction, "UPDATE WorkBatches SET Version=Version+1 WHERE Id=@batch", [("batch", batchId)]);
    }
    private async Task Recover(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document)
    {
        var input = document.Input;
        var batchId = input.BatchId!.Value;
        await inventory.Batch(connection, transaction, batchId, actor, false);
        await inventory.BatchDependencies(connection, transaction, batchId, document.Id);
        foreach (var line in Merge(input.Items))
        {
            var archive = await inventory.Archive(connection, transaction, line.ItemId, ArchiveKinds.Packaging);
            InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
            var changed = await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances SET Recovered=Recovered+@quantity,Outstanding=Outstanding-@quantity,Version=Version+1 WHERE BatchId=@batch AND ItemId=@item AND Outstanding>=@quantity", [("batch", batchId), ("item", line.ItemId), ("quantity", line.Quantity)]);
            if (changed != 1)
            {
                throw BusinessException.Conflict("INSUFFICIENT_EXTERNAL_PACKAGING", "回收包装超过本批次在外余额");
            }

            await inventory.ChangeWarehouse(connection, transaction, line.ItemId, line.Quantity, document.Id, actor.Id, InventoryDomains.WarehousePackaging, DocumentKinds.Recovery, batchId);
            await inventory.Ledger(connection, transaction, InventoryDomains.ExternalPackaging, line.ItemId, batchId, -line.Quantity, DocumentKinds.Recovery, document.Id, actor.Id);
            await documents.AddLine(connection, transaction, document.Id, "RECOVERY_PACKAGING", line, archive, batchId);
        }
        foreach (var line in Merge(input.Vegetables ?? []))
        {
            var archive = await inventory.Archive(connection, transaction, line.ItemId, InventoryDomains.Vegetable);
            InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
            await Database.Execute(connection, transaction, "INSERT INTO BatchVegetableBalances(BatchId,ItemId,Output,Received) VALUES(@batch,@item,0,@quantity) ON DUPLICATE KEY UPDATE Received=Received+@quantity", [("batch", batchId), ("item", line.ItemId), ("quantity", line.Quantity)]);
            await inventory.ChangeWarehouse(connection, transaction, line.ItemId, line.Quantity, document.Id, actor.Id, InventoryDomains.Vegetable, DocumentKinds.Recovery, batchId);
            await documents.AddLine(connection, transaction, document.Id, "RECEIVED", line, archive, batchId);
        }
        var differences = await Database.Query(connection, transaction, "SELECT ItemId,Output,Received,Output-Received AS Difference FROM BatchVegetableBalances WHERE BatchId=@batch ORDER BY ItemId FOR UPDATE", ("batch", batchId));
        var needsReason = input.Mode == RecoveryModes.Final ? differences.Any(row => row.Quantity("Difference") != 0) : differences.Any(row => row.Quantity("Difference") < 0);
        if (needsReason && string.IsNullOrWhiteSpace(input.DifferenceReason))
        {
            throw BusinessException.Invalid("产出/实收存在差异，必须填写原因");
        }

        if (input.Mode == RecoveryModes.Final)
        {
            if (!input.ConfirmFinal)
            {
                throw BusinessException.Invalid("最终收完需要明确确认包装对账和蔬菜差异");
            }

            var packaging = await Database.Query(connection, transaction, "SELECT ItemId,Outstanding FROM BatchPackagingBalances WHERE BatchId=@batch ORDER BY ItemId FOR UPDATE", ("batch", batchId));
            if (packaging.Any(row => row.Quantity("Outstanding") > 0) && string.IsNullOrWhiteSpace(input.LossReason))
            {
                throw BusinessException.Invalid("未收回包装将记为损耗，请填写原因");
            }

            foreach (var row in packaging)
            {
                if (row.Quantity("Outstanding") != 0)
                {
                    await inventory.Ledger(connection, transaction, InventoryDomains.ExternalPackaging, row.Id("ItemId"), batchId, -row.Quantity("Outstanding"), "LOSS", document.Id, actor.Id);
                }
            }
            await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances SET Lost=Outstanding,Outstanding=0,Version=Version+1 WHERE BatchId=@batch", [("batch", batchId)]);
            await Database.Execute(connection, transaction, "UPDATE WorkBatches SET Status='CLOSED',FinalRecoveryId=@document,Version=Version+1 WHERE Id=@batch", [("document", document.Id), ("batch", batchId)]);
        }
        else
        {
            await Database.Execute(connection, transaction, "UPDATE WorkBatches SET Version=Version+1 WHERE Id=@batch", [("batch", batchId)]);
        }
    }
    private async Task Outbound(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document)
    {
        var customer = await inventory.Archive(connection, transaction, document.Input.CustomerId!.Value, ArchiveKinds.Customer);
        await Database.Execute(connection, transaction, "UPDATE Documents SET CustomerId=@customer,CustomerName=@name WHERE Id=@id", [("customer", document.Input.CustomerId), ("name", customer.Text("Name")), ("id", document.Id)]);
        foreach (var line in Merge(document.Input.Items))
        {
            var archive = await inventory.Archive(connection, transaction, line.ItemId, InventoryDomains.Vegetable);
            InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
            // DIRECT 只是展示负数，数据库业务数量为正，库存变化统一为负。
            await inventory.ChangeWarehouse(connection, transaction, line.ItemId, -line.Quantity, document.Id, actor.Id, InventoryDomains.Vegetable, DocumentKinds.Outbound);
            await documents.AddLine(connection, transaction, document.Id, DocumentKinds.Outbound, line, archive);
        }
    }
    private async Task Stock(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document)
    {
        foreach (var line in Merge(document.Input.Items))
        {
            var rows = await Database.Query(connection, transaction, "SELECT Kind FROM Archives WHERE Id=@item", ("item", line.ItemId));
            if (rows.Count == 0 || rows[0].Text("Kind") is not (ArchiveKinds.Packaging or InventoryDomains.Vegetable))
            {
                throw BusinessException.Invalid("库存单只能使用包装或蔬菜档案");
            }

            var kind = rows[0].Text("Kind");
            if (document.Input.Source == StockSources.External && kind != InventoryDomains.Vegetable || document.Input.Source == StockSources.Replenishment && kind != ArchiveKinds.Packaging)
            {
                throw BusinessException.Invalid("外来菜/包装补充来源与品类不符");
            }

            if (line.Direction == "OUT" && document.Input.Source != StockSources.Adjustment)
            {
                throw BusinessException.Invalid("仅库存调整可使用减少方向");
            }

            var archive = await inventory.Archive(connection, transaction, line.ItemId, kind);
            InventoryRepository.ValidateQuantity(line.Quantity, archive.Text("Unit"));
            await inventory.ChangeWarehouse(connection, transaction, line.ItemId, line.Direction == "OUT" ? -line.Quantity : line.Quantity, document.Id, actor.Id, kind == ArchiveKinds.Packaging ? InventoryDomains.WarehousePackaging : InventoryDomains.Vegetable, document.Input.Source);
            await documents.AddLine(connection, transaction, document.Id, DocumentKinds.Stock, line, archive);
        }
    }
    public Task<SubmissionResult> Reverse(Actor actor, string kind, long id, string reason, string key, string requestId)
    {
        actor.RequirePermission("documents.reverse");
        ValidateReason(reason);
        return transactions.Idempotent(actor, $"{kind}:{id}:reverse", key, new { reason }, async (connection, transaction) =>
        {
            var document = await documents.Get(connection, transaction, id, true);
            if (document.Kind != kind)
            {
                throw new BusinessException(404, "NOT_FOUND", "未找到单据");
            }

            await ReverseCore(connection, transaction, actor, document, reason, requestId);
            return new SubmissionResult(id, document.Number, DocumentStatuses.Reversed, document.Version + 1);
        });
    }
    public Task<SubmissionResult> Correct(Actor actor, string kind, long id, CorrectInput request, string key, string requestId)
    {
        actor.RequirePermission("documents.correct");
        ValidateReason(request.Reason);
        Validate(request.Document, kind);
        return transactions.Idempotent(actor, $"{kind}:{id}:correct", key, request, async (connection, transaction) =>
        {
            var document = await documents.Get(connection, transaction, id, true);
            if (document.Kind != kind)
            {
                throw new BusinessException(404, "NOT_FOUND", "未找到单据");
            }

            await ReverseCore(connection, transaction, actor, document, request.Reason, requestId);
            var replacement = await documents.Create(connection, transaction, kind, document.CreatorId, request.Document, document.Id);
            var result = await PostCore(connection, transaction, actor, replacement, requestId);
            await documents.Audit(connection, transaction, actor, "CORRECT", kind, document.Id, document.Input, request.Document, request.Reason, requestId);
            return result;
        });
    }
    private static void ValidateReason(string reason)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 500)
        {
            throw BusinessException.Invalid("冲销/修正必须填写理由，最多 500 字");
        }
    }
    private async Task ReverseCore(MySqlConnection connection, MySqlTransaction transaction, Actor actor, DocumentRecord document, string reason, string requestId)
    {
        if (document.Status != DocumentStatuses.Posted)
        {
            throw BusinessException.Conflict("NOT_POSTED", "只有已提交单据可以冲销");
        }

        var dependencies = await Database.Query(connection, transaction,
            "SELECT d.Id,d.Number,d.Kind FROM DocumentDependencies x JOIN Documents d ON d.Id=x.ChildId WHERE x.ParentId=@id AND d.Status='POSTED' ORDER BY d.Id DESC", ("id", document.Id));
        if (dependencies.Count > 0)
        {
            throw BusinessException.Conflict("DEPENDENCY_BLOCKS_REVERSAL", "请先按逆序冲销依赖单据", dependencies.Select(row => row.Output()).ToArray());
        }

        var ledgers = await Database.Query(connection, transaction, "SELECT * FROM InventoryLedger WHERE DocumentId=@id AND ReversalOf IS NULL ORDER BY Domain,ItemId,Id", ("id", document.Id));
        foreach (var row in ledgers)
        {
            var batchId = row.IsNull("BatchId") ? (long?)null : row.Id("BatchId");
            if (row.Text("Domain") != InventoryDomains.ExternalPackaging)
            {
                await inventory.ChangeWarehouse(connection, transaction, row.Id("ItemId"), -row.Quantity("Delta"), document.Id, actor.Id, row.Text("Domain"), "REVERSAL", batchId, row.Id("Id"));
            }
            else
            {
                await inventory.Ledger(connection, transaction, row.Text("Domain"), row.Id("ItemId"), batchId, -row.Quantity("Delta"), "REVERSAL", document.Id, actor.Id, row.Id("Id"));
            }
        }
        var lines = await Database.Query(connection, transaction, "SELECT * FROM DocumentItems WHERE DocumentId=@id ORDER BY ItemId", ("id", document.Id));
        if (document.Kind == DocumentKinds.Recovery && document.Input.Mode == RecoveryModes.Final)
        {
            await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances SET Outstanding=Outstanding+Lost,Lost=0,Version=Version+1 WHERE BatchId=@batch", [("batch", document.Input.BatchId)]);
            await Database.Execute(connection, transaction, "UPDATE WorkBatches SET Status='OPEN',FinalRecoveryId=NULL,Version=Version+1 WHERE Id=@batch", [("batch", document.Input.BatchId)]);
        }
        foreach (var line in lines)
        {
            var parameters = new (string, object?)[] { ("batch", line.IsNull("BatchId") ? null : line.Id("BatchId")), ("item", line.Id("ItemId")), ("quantity", line.Quantity("Quantity")) };
            switch (line.Text("LineKind"))
            {
                case "CONSUMPTION":
                    await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances SET Consumed=Consumed-@quantity,Outstanding=Outstanding+@quantity,Version=Version+1 WHERE BatchId=@batch AND ItemId=@item", parameters); break;
                case "RECOVERY_PACKAGING":
                    await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances SET Recovered=Recovered-@quantity,Outstanding=Outstanding+@quantity,Version=Version+1 WHERE BatchId=@batch AND ItemId=@item", parameters); break;
                case "OUTPUT":
                    await Database.Execute(connection, transaction, "UPDATE BatchVegetableBalances SET Output=Output-@quantity WHERE BatchId=@batch AND ItemId=@item", parameters); break;
                case "RECEIVED":
                    await Database.Execute(connection, transaction, "UPDATE BatchVegetableBalances SET Received=Received-@quantity WHERE BatchId=@batch AND ItemId=@item", parameters); break;
            }
        }
        if (document.Kind == DocumentKinds.Dispatch)
        {
            await Database.Execute(connection, transaction, "UPDATE BatchPackagingBalances p JOIN WorkBatches b ON b.Id=p.BatchId SET p.Dispatched=0,p.Outstanding=0,p.Version=p.Version+1 WHERE b.DispatchId=@id", [("id", document.Id)]);
            await Database.Execute(connection, transaction, "UPDATE WorkBatches SET Status='REVERSED',Version=Version+1 WHERE DispatchId=@id", [("id", document.Id)]);
        }
        await Database.Execute(connection, transaction, "UPDATE Documents SET Status='REVERSED',Version=Version+1 WHERE Id=@id", [("id", document.Id)]);
        await documents.Audit(connection, transaction, actor, "REVERSE", document.Kind, document.Id, document.Input, new { status = DocumentStatuses.Reversed }, reason, requestId);
    }
}
