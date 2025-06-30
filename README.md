# KATANA PREDEPOSITS DATA FETCHING

## fetch_krates_events.js

This script fetches all `DepositProcessed` events from the Ethereum mainnet contract at address:
`0xb01dadec98308528ee57a17b24a473213c1704bb`

### Installation & Usage

```bash
npm install
```

`node fetch_krates_events.js` or `npm start`

### Processing Details

The script uses **chunked processing** to handle RPC provider limits:

- Processes blocks in chunks of 1000 (most RPC providers limit requests to 1000 blocks)
- Current range: blocks 22,547,938 to 22,770,565 (~222K blocks)
- Estimated processing time: **8-10 minutes** for the full range
- Includes progress tracking and rate limiting protection

### Output

The script will:

1. Connect to Ethereum mainnet using public RPC endpoints
2. Fetch all `DepositProcessed` events using chunked requests (1000 blocks per request)
3. Display real-time progress: `Fetching chunk 15/223: blocks 22561938 to 22562937`
4. Save the events to `krates_events.csv`
5. Display a summary of found events

### Output Format

The output CSV file (`krates_events.csv`) contains the following columns:

- `asset`: The asset address from the event
- `user`: The user address from the event
- `amount`: The deposit amount as a string (to handle large numbers)

Example output:

```csv
asset,address,amount
0x1234567890123456789012345678901234567890,0xabcdefabcdefabcdefabcdefabcdefabcdefabcd,1000000000000000000
0x9876543210987654321098765432109876543210,0x1111222233334444555566667777888899990000,2000000000000000000
```

### Performance

- **Total blocks**: ~222K blocks
- **Number of requests**: 223 chunks
- **Rate limiting**: 100ms delay between requests
- **Expected runtime**: 8-10 minutes for full range

## fetch_vault_balance.js
