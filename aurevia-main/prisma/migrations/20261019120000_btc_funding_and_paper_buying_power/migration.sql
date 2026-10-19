ALTER TABLE "FundingRequest"
    ADD COLUMN "creditedCurrency" TEXT;

ALTER TABLE "Order"
    ADD COLUMN "providerReservedAmount" DECIMAL(30, 10);

CREATE UNIQUE INDEX "FundingRequest_real_bitcoin_txid_key"
    ON "FundingRequest" (LOWER("transactionReference"))
    WHERE "accountMode" = 'REAL'
      AND "type" = 'DEPOSIT'
      AND "currency" = 'BTC'
      AND "network" = 'BITCOIN'
      AND "method" = 'BTC deposit · manual verification'
      AND "transactionReference" IS NOT NULL;
