#!/usr/bin/env node
/**
 * Script to fetch all DepositProcessed events from an Ethereum mainnet contract using ethers.js
 */

import { ethers } from 'ethers';
import fs from 'fs';

// Contract address
const CONTRACT_ADDRESS = "0xb01dadec98308528ee57a17b24a473213c1704bb";

// Ethereum mainnet RPC endpoints
const RPC_ENDPOINTS = [
    // "https://eth-mainnet.g.alchemy.com/v2/demo",  // Free tier, rate limited
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
 * Fetch DepositProcessed events from the contract for a specific block range
 */
async function getDepositProcessedEventsForRange(provider, contractAddress, fromBlock, toBlock) {
    // Event signature: DepositProcessed(address,address,uint256,uint256,address)
    const eventSignature = "DepositProcessed(address,address,uint256,uint256,address)";
    const topic = ethers.id(eventSignature);
    
    try {
        const logs = await provider.getLogs({
            address: contractAddress,
            fromBlock: fromBlock,
            toBlock: toBlock,
            topics: [topic]
        });
        
        return logs;
        
    } catch (error) {
        console.error(`Error fetching events for blocks ${fromBlock}-${toBlock}: ${error.message}`);
        return [];
    }
}

/**
 * Fetch all DepositProcessed events from the contract using chunked requests
 */
async function getDepositProcessedEvents(provider, contractAddress, fromBlock = 0, toBlock = 'latest', chunkSize = 1000) {
    const eventSignature = "DepositProcessed(address,address,uint256,uint256,address)";
    const topic = ethers.id(eventSignature);
    
    console.log(`Searching for events with topic: ${topic}`);
    
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
        
        const chunkEvents = await getDepositProcessedEventsForRange(
            provider, 
            contractAddress, 
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
    
    console.log(`Found ${allEvents.length} total events with topic ${topic}`);
    return allEvents;
}

/**
 * Format events to extract only asset, user, and amount
 */
function formatEvents(events) {
    const formattedEvents = [];
    
    for (const event of events) {
        try {
            // DepositProcessed(address,address,uint256,uint256,address)
            // topics[0] = event signature hash
            // topics[1] = asset (indexed address)
            // topics[2] = user (indexed address) 
            // topics[3] = amount (indexed uint256)
            // data contains: chainid (uint256), referral (address)
            
            const topics = event.topics;
            
            if (topics.length >= 4) {
                // Extract asset and user from topics (they are indexed)
                const asset = ethers.getAddress('0x' + topics[1].slice(-40));
                const user = ethers.getAddress('0x' + topics[2].slice(-40));
                
                // Extract amount from topics[3] (it's indexed)
                const amountHex = topics[3].slice(2); // Remove '0x' prefix
                
                let amount;
                try {
                    console.log(amountHex);
                    amount = BigInt('0x' + amountHex);
                } catch (error) {
                    console.log(`Failed to parse amount hex '${amountHex}': ${error.message}`);
                    continue;
                }
                
                const formattedEvent = {
                    asset: asset,
                    user: user,
                    amount: amount.toString() // Convert BigInt to string for JSON serialization
                };
                
                formattedEvents.push(formattedEvent);
            }
                
        } catch (error) {
            console.error(`Error parsing event: ${error.message}`);
            continue;
        }
    }
    
    return formattedEvents;
}

/**
 * Group events by user and asset, summing amounts
 */
function groupEventsByUserAndAsset(events) {
    const grouped = {};
    
    for (const event of events) {
        const key = `${event.user}-${event.asset}`;
        
        if (grouped[key]) {
            // Add to existing amount (convert to BigInt for precise addition)
            const existingAmount = BigInt(grouped[key].amount);
            const newAmount = BigInt(event.amount);
            grouped[key].amount = (existingAmount + newAmount).toString();
        } else {
            // Create new entry
            grouped[key] = {
                user: event.user,
                asset: event.asset,
                amount: event.amount
            };
        }
    }
    
    // Convert to array and sort by user, then by asset
    return Object.values(grouped).sort((a, b) => {
        if (a.user !== b.user) {
            return a.user.localeCompare(b.user);
        }
        return a.asset.localeCompare(b.asset);
    });
}

/**
 * Save events to CSV file
 */
function saveEventsToFile(events, filename = 'krates_events.csv') {
    try {
        // Create CSV header
        const csvHeader = 'asset,address,amount\n';
        
        // Convert events to CSV rows
        const csvRows = events.map(event => 
            `${event.asset},${event.user},${event.amount}`
        ).join('\n');
        
        // Combine header and rows
        const csvContent = csvHeader + csvRows;
        
        fs.writeFileSync(filename, csvContent);
        console.log(`Saved ${events.length} events to ${filename}`);
    } catch (error) {
        console.error(`Error saving events to file: ${error.message}`);
    }
}

/**
 * Save grouped events to CSV file
 */
function saveGroupedEventsToFile(groupedEvents, filename = 'kraters_grouped.csv') {
    try {
        // Create CSV header
        const csvHeader = 'user,asset,total_amount\n';
        
        // Convert grouped events to CSV rows
        const csvRows = groupedEvents.map(event => 
            `${event.user},${event.asset},${event.amount}`
        ).join('\n');
        
        // Combine header and rows
        const csvContent = csvHeader + csvRows;
        
        fs.writeFileSync(filename, csvContent);
        console.log(`Saved ${groupedEvents.length} grouped entries to ${filename}`);
    } catch (error) {
        console.error(`Error saving grouped events to file: ${error.message}`);
    }
}

/**
 * Main function to fetch and process events
 */
async function main() {
    try {
        console.log(`Fetching DepositProcessed events from contract: ${CONTRACT_ADDRESS}`);
        
        // Get provider connection
        const provider = await getProvider();
        
        // Get current block for progress tracking
        const currentBlock = await provider.getBlockNumber();
        console.log(`Current block: ${currentBlock}`);
        
        // Fetch events with specific block range
        console.log("Fetching events... This may take a while for contracts with many events.");
        const events = await getDepositProcessedEvents(
            provider, 
            CONTRACT_ADDRESS, 
            22547938,  // first block with events
            22770577 // last block with events
        );
        
        if (events.length === 0) {
            console.log("No DepositProcessed events found.");
            return;
        }
        
        console.log(`Found ${events.length} DepositProcessed events`);
        
        // Format events
        const formattedEvents = formatEvents(events);
        
        // Save individual events to file
        saveEventsToFile(formattedEvents);
        
        // Group events by user and asset
        const groupedEvents = groupEventsByUserAndAsset(formattedEvents);
        
        // Save grouped events to file
        saveGroupedEventsToFile(groupedEvents);
        
        // Print summary
        if (formattedEvents.length > 0) {
            console.log("\nEvent Summary:");
            console.log(`Total individual events: ${formattedEvents.length}`);
            console.log(`Total unique user-asset pairs: ${groupedEvents.length}`);
            
            // Show first few individual events
            console.log("\nFirst few individual events:");
            for (let i = 0; i < Math.min(3, formattedEvents.length); i++) {
                const event = formattedEvents[i];
                console.log(`  Event ${i + 1}:`);
                console.log(`    Asset: ${event.asset}`);
                console.log(`    User: ${event.user}`);
                console.log(`    Amount: ${event.amount}`);
                console.log();
            }
            
            // Show first few grouped entries
            console.log("\nFirst few grouped entries:");
            for (let i = 0; i < Math.min(3, groupedEvents.length); i++) {
                const entry = groupedEvents[i];
                console.log(`  Entry ${i + 1}:`);
                console.log(`    User: ${entry.user}`);
                console.log(`    Asset: ${entry.asset}`);
                console.log(`    Total Amount: ${entry.amount}`);
                console.log();
            }
        }
        
    } catch (error) {
        console.error(`Error in main function: ${error.message}`);
        process.exit(1);
    }
}

// Run the script
main(); 