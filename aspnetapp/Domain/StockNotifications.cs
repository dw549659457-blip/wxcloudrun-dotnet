namespace aspnetapp.Domain;

public sealed record NotificationLine(long ItemId, string Name, string Unit, string Domain, decimal Delta, decimal? Balance);
public sealed record StockNotification(long Id, long DocumentId, string Number, string Kind, string Action,
    string Title, string Actor, string Party, string BusinessDate, DateTime OccurredAt, NotificationLine[] Lines, int LineCount);
public sealed record NotificationReadInput(long ThroughId);
public sealed record NotificationSubscriptionInput(string TemplateId, string Decision);
public sealed record NotificationPauseInput(bool Paused);
