ALTER TABLE "Execution"
ADD COLUMN "accountMode" "AccountMode" NOT NULL DEFAULT 'DEMO';

ALTER TABLE "LedgerTransaction"
ADD COLUMN "accountMode" "AccountMode" NOT NULL DEFAULT 'DEMO';

ALTER TABLE "LedgerEntry"
ADD COLUMN "accountMode" "AccountMode" NOT NULL DEFAULT 'DEMO';

UPDATE "Execution" AS execution
SET "accountMode" = orders."accountMode"
FROM "Order" AS orders
WHERE execution."orderId" = orders."id";

UPDATE "LedgerEntry" AS entry
SET "accountMode" = account."accountMode"
FROM "LedgerAccount" AS account
WHERE entry."accountId" = account."id";

UPDATE "LedgerTransaction" AS ledger_tx
SET "accountMode" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "LedgerEntry" AS entry
    JOIN "LedgerAccount" AS account ON account."id" = entry."accountId"
    WHERE entry."transactionId" = ledger_tx."id"
      AND account."accountMode" = 'REAL'
  ) THEN 'REAL'::"AccountMode"
  ELSE 'DEMO'::"AccountMode"
END;

CREATE INDEX "Execution_accountMode_createdAt_idx"
ON "Execution"("accountMode", "createdAt");

CREATE INDEX "LedgerTransaction_accountMode_createdAt_idx"
ON "LedgerTransaction"("accountMode", "createdAt");

CREATE INDEX "LedgerEntry_accountMode_createdAt_idx"
ON "LedgerEntry"("accountMode", "createdAt");
