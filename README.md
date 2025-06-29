# Ethereum DepositProcessed Events Fetcher

This script fetches all `DepositProcessed` events from the Ethereum mainnet contract at address:
`0xb01dadec98308528ee57a17b24a473213c1704bb`

## Node/ethers

```bash
npm install
```

`node fetch_deposit_events.js` or `npm start`

## Output

The script will:
1. Connect to Ethereum mainnet using public RPC endpoints
2. Fetch all `DepositProcessed` events from the specified contract (blocks 22547938-22547955)
3. Save the events to `deposit_processed_events.csv`
4. Display a summary of found events

## Output Format

The output is a CSV file with the following columns:
- `asset`: The asset address from the event
- `user`: The user address from the event  
- `amount`: The deposit amount as a string (to handle large numbers)

Example output:
```csv
asset,address,amount
0x1234567890123456789012345678901234567890,0xabcdefabcdefabcdefabcdefabcdefabcdefabcd,1000000000000000000
0x9876543210987654321098765432109876543210,0x1111222233334444555566667777888899990000,2000000000000000000
```
