#!/usr/bin/env node
/**
 * Script to track balance changes in an ERC-4626 vault contract using ethers.js
 * 
 * This script monitors:
 * - Deposit events: When users deposit underlying assets and receive vault shares
 * - Withdraw events: When users redeem vault shares for underlying assets
 * - Share Transfer events: When vault shares are transferred between addresses
 * 
 * The script calculates the running balance of underlying assets in the vault,
 * which increases on deposits and decreases on withdrawals.
 */

import { ethers } from 'ethers';
import fs from 'fs';

// Ethereum mainnet RPC endpoints
const RPC_ENDPOINTS = [
    "https://eth.llamarpc.com",  // Free public RPC
];

/**
 * Get a provider connection to Ethereum mainnet
 */
async function getProvider() {
    for (const endpoint of RPC_ENDPOINTS) {
        try {
            const provider = new ethers.JsonRpcProvider(endpoint);
            // Test the connection
            await provider.getBlockNumber();
            console.log(`Connected to Ethereum mainnet via ${endpoint}`);
            return provider;
        } catch (error) {
            console.log(`Failed to connect to ${endpoint}: ${error.message}`);
            continue;
        }
    }
    
    throw new Error("Failed to connect to any Ethereum RPC endpoint");
}

/**
 * Fetch events from the vault for a specific block range
 */
async function getVaultEventsForRange(provider, vaultAddress, fromBlock, toBlock) {
    // ERC-4626 vault event signatures
    const eventSignatures = {
        'Transfer': 'Transfer(address,address,uint256)',
        'Deposit': 'Deposit(address,address,uint256,uint256)', // ERC-4626: caller, owner, assets, shares
        'Withdraw': 'Withdraw(address,address,address,uint256,uint256)' // ERC-4626: caller, receiver, owner, assets, shares
    };
    
    const topics = Object.values(eventSignatures).map(sig => ethers.id(sig));
    
    try {
        const logs = await provider.getLogs({
            address: vaultAddress,
            fromBlock: fromBlock,
            toBlock: toBlock,
            topics: [topics] // OR condition for any of these events
        });
        
        return logs;
        
    } catch (error) {
        console.error(`Error fetching events for blocks ${fromBlock}-${toBlock}: ${error.message}`);
        return [];
    }
}

/**
 * Fetch all vault events using chunked requests
 */
async function getVaultEvents(provider, vaultAddress, fromBlock = 0, toBlock = 'latest', chunkSize = 1000) {
    console.log(`Searching for vault events from ${vaultAddress}`);
    
    // Convert toBlock to number if it's 'latest'
    if (toBlock === 'latest') {
        toBlock = await provider.getBlockNumber();
    }
    
    const totalBlocks = toBlock - fromBlock + 1;
    const totalChunks = Math.ceil(totalBlocks / chunkSize);
    
    console.log(`Total blocks to scan: ${totalBlocks}`);
    console.log(`Will make ${totalChunks} requests with chunk size of ${chunkSize} blocks`);
    
    let allEvents = [];
    
    for (let i = 0; i < totalChunks; i++) {
        const chunkFromBlock = fromBlock + (i * chunkSize);
        const chunkToBlock = Math.min(chunkFromBlock + chunkSize - 1, toBlock);
        
        console.log(`Fetching chunk ${i + 1}/${totalChunks}: blocks ${chunkFromBlock} to ${chunkToBlock}`);
        
        const chunkEvents = await getVaultEventsForRange(
            provider, 
            vaultAddress, 
            chunkFromBlock, 
            chunkToBlock
        );
        
        allEvents = allEvents.concat(chunkEvents);
        console.log(`  Found ${chunkEvents.length} events in this chunk (total so far: ${allEvents.length})`);
        
        // Add a small delay to avoid rate limiting
        if (i < totalChunks - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    console.log(`Found ${allEvents.length} total vault events`);
    return allEvents;
}

/**
 * Format events to extract balance changes
 */
function formatEvents(events) {
    const formattedEvents = [];
    const eventSignatures = {
        [ethers.id('Transfer(address,address,uint256)')]: 'Transfer',
        [ethers.id('Deposit(address,address,uint256,uint256)')]: 'Deposit', // ERC-4626
        [ethers.id('Withdraw(address,address,address,uint256,uint256)')]: 'Withdraw' // ERC-4626
    };
    
    for (const event of events) {
        try {
            const eventType = eventSignatures[event.topics[0]];
            if (!eventType) continue;
            
            let formattedEvent = {
                blockNumber: event.blockNumber,
                transactionHash: event.transactionHash,
                eventType: eventType,
                caller: '',
                owner: '',
                receiver: '',
                assets: '0',
                shares: '0',
                balanceChange: '0' // positive for deposits, negative for withdrawals
            };
            
            if (eventType === 'Transfer') {
                // Transfer(address from, address to, uint256 value) - ERC-20 shares transfer
                const from = ethers.getAddress('0x' + event.topics[1].slice(-40));
                const to = ethers.getAddress('0x' + event.topics[2].slice(-40));
                const shares = BigInt(event.data);
                
                // This is a share transfer, not an asset balance change
                // We'll track it but it doesn't affect underlying asset balance
                formattedEvent.eventType = 'ShareTransfer';
                formattedEvent.caller = from;
                formattedEvent.receiver = to;
                formattedEvent.shares = shares.toString();
                formattedEvent.balanceChange = '0'; // Share transfers don't change asset balance
                
            } else if (eventType === 'Deposit') {
                // Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
                const caller = ethers.getAddress('0x' + event.topics[1].slice(-40));
                const owner = ethers.getAddress('0x' + event.topics[2].slice(-40));
                
                // Parse data for assets and shares (both uint256)
                const dataHex = event.data.slice(2); // Remove '0x'
                const assets = BigInt('0x' + dataHex.slice(0, 64));
                const shares = BigInt('0x' + dataHex.slice(64, 128));
                
                formattedEvent.caller = caller;
                formattedEvent.owner = owner;
                formattedEvent.receiver = owner; // In deposits, owner receives the shares
                formattedEvent.assets = assets.toString();
                formattedEvent.shares = shares.toString();
                formattedEvent.balanceChange = assets.toString(); // Assets increase vault balance
                
            } else if (eventType === 'Withdraw') {
                // Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
                const caller = ethers.getAddress('0x' + event.topics[1].slice(-40));
                const receiver = ethers.getAddress('0x' + event.topics[2].slice(-40));
                const owner = ethers.getAddress('0x' + event.topics[3].slice(-40));
                
                // Parse data for assets and shares (both uint256)
                const dataHex = event.data.slice(2); // Remove '0x'
                const assets = BigInt('0x' + dataHex.slice(0, 64));
                const shares = BigInt('0x' + dataHex.slice(64, 128));
                
                formattedEvent.caller = caller;
                formattedEvent.owner = owner;
                formattedEvent.receiver = receiver;
                formattedEvent.assets = assets.toString();
                formattedEvent.shares = shares.toString();
                formattedEvent.balanceChange = (-assets).toString(); // Assets decrease vault balance
            }
            
            // Only include events that have meaningful data
            if (formattedEvent.caller || formattedEvent.owner || formattedEvent.receiver) {
                formattedEvents.push(formattedEvent);
            }
                
        } catch (error) {
            console.error(`Error parsing event: ${error.message}`);
            console.error(`Event data: ${JSON.stringify(event)}`);
            continue;
        }
    }
    
    // Sort by block number for chronological order
    return formattedEvents.sort((a, b) => a.blockNumber - b.blockNumber);
}

/**
 * Calculate running balance from events
 */
function calculateRunningBalance(events) {
    let runningBalance = BigInt(0);
    const balanceHistory = [];
    
    for (const event of events) {
        const balanceChange = BigInt(event.balanceChange);
        runningBalance += balanceChange;
        
        balanceHistory.push({
            ...event,
            runningBalance: runningBalance.toString()
        });
    }
    
    return balanceHistory;
}

/**
 * Save user balances to CSV file
 */
function saveUserBalances(events, vaultAddress) {
    try {
        const userBalances = {};
        const EXCLUDED_USER = "0x836304B832687f3811a0dF935934C724B40578eB";
        
        // Group events by user and calculate totals
        for (const event of events) {
            // Skip share transfers as they don't affect user's deposit/withdrawal balance
            if (event.eventType === 'ShareTransfer') continue;
            
            const userAddress = event.owner; // Use owner as the user address
            if (!userAddress) continue;
            
            // Skip events from excluded user
            if (userAddress.toLowerCase() === EXCLUDED_USER.toLowerCase()) continue;
            
            if (!userBalances[userAddress]) {
                userBalances[userAddress] = {
                    user_address: userAddress,
                    total_deposited: BigInt(0),
                    total_withdrawn: BigInt(0)
                };
            }
            
            const assets = BigInt(event.assets || '0');
            
            if (event.eventType === 'Deposit') {
                userBalances[userAddress].total_deposited += assets;
            } else if (event.eventType === 'Withdraw') {
                userBalances[userAddress].total_withdrawn += assets;
            }
        }
        
        // Create unique filename for this vault
        const shortAddress = vaultAddress.slice(0, 8); // First 8 characters including 0x
        const filename = `vault_user_balances_${shortAddress}.csv`;
        
        // Calculate net balance and filter out users with zero net balance
        const csvHeader = 'vault,user,amount\n';
        const csvRows = Object.values(userBalances)
            .map(user => {
                const netBalance = user.total_deposited - user.total_withdrawn;
                return {
                    ...user,
                    netBalance
                };
            })
            .filter(user => user.netBalance !== BigInt(0)) // Filter out zero net balance
            .map(user => `${vaultAddress},${user.user_address},${user.netBalance.toString()}`)
            .join('\n');
        
        const csvContent = csvHeader + csvRows;
        
        fs.writeFileSync(filename, csvContent);
        console.log(`Saved user balances to ${filename}`);
        
        // Count users with non-zero net balance
        const usersWithBalance = Object.values(userBalances).filter(user => {
            const netBalance = user.total_deposited - user.total_withdrawn;
            return netBalance !== BigInt(0);
        }).length;
        
        console.log(`Total unique users with non-zero balance: ${usersWithBalance}`);
        
        // Calculate totals for summary
        let totalDeposits = BigInt(0);
        let totalWithdrawals = BigInt(0);
        Object.values(userBalances).forEach(user => {
            totalDeposits += user.total_deposited;
            totalWithdrawals += user.total_withdrawn;
        });
        
        return { 
            userCount: usersWithBalance,
            totalDeposits: totalDeposits.toString(),
            totalWithdrawals: totalWithdrawals.toString(),
            netBalance: (totalDeposits - totalWithdrawals).toString()
        };
        
    } catch (error) {
        console.error(`Error saving user balances: ${error.message}`);
        return null;
    }
}

/**
 * Main function to fetch and process vault events
 */
async function main() {
    const VAULTS = [
        "0x7B5A0182E400b241b317e781a4e9dEdFc1429822",
        "0x48c03B6FfD0008460F8657Db1037C7e09dEedfcb",
        "0x92C82f5F771F6A44CfA09357DD0575B81BF5F728",
        "0xcc6a16Be713f6a714f68b0E1f4914fD3db15fBeF"
    ];

    for (let VAULT_ADDRESS of VAULTS) {
        try {
            console.log(`\n=== Tracking balance changes for vault: ${VAULT_ADDRESS} ===`);
            
            // Get provider connection
            const provider = await getProvider();
            
            // Get current block for progress tracking
            const currentBlock = await provider.getBlockNumber();
            console.log(`Current block: ${currentBlock}`);
            
            // Determine block range (you may need to adjust these)
            const fromBlock = 22547938; // first deposit from krates
            const toBlock = currentBlock;
            
            // Fetch events
            console.log("Fetching vault events... This may take a while.");
            const events = await getVaultEvents(
                provider, 
                VAULT_ADDRESS, 
                fromBlock, 
                toBlock
            );
            
            if (events.length === 0) {
                console.log("No vault events found.");
                return;
            }
            
            console.log(`Found ${events.length} vault events`);
            
            // Format events
            const formattedEvents = formatEvents(events);
            
            // Calculate running balance
            const balanceHistory = calculateRunningBalance(formattedEvents);
            
            // Save user balances to CSV
            const summary = saveUserBalances(formattedEvents, VAULT_ADDRESS);
            
            // Print summary
            if (formattedEvents.length > 0 && summary) {
                console.log("\nVault User Balance Summary:");
                console.log(`Total events processed: ${formattedEvents.length}`);
                console.log(`Total unique users: ${summary.userCount}`);
                console.log(`Total deposits: ${summary.totalDeposits} underlying assets`);
                console.log(`Total withdrawals: ${summary.totalWithdrawals} underlying assets`);
                console.log(`Net vault balance: ${summary.netBalance} underlying assets`);
            } else {
                console.log("\nNo deposit/withdrawal events found.");
                console.log("No user balances to report.");
            }
            
        } catch (error) {
            console.error(`Error processing vault ${VAULT_ADDRESS}: ${error.message}`);
            console.log(`Continuing with next vault...\n`);
        }
    }
    
    console.log("=== Finished processing all vaults ===");
}

// Run the script
main(); 