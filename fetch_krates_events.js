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
 * Fetch all DepositProcessed events from the contract
 */
async function getDepositProcessedEvents(provider, contractAddress, fromBlock = 0, toBlock = 'latest') {
    // Event signature: DepositProcessed(address,address,uint256,uint256,address)
    const eventSignature = "DepositProcessed(address,address,uint256,uint256,address)";
    const topic = ethers.id(eventSignature);
    
    console.log(`Searching for events with topic: ${topic}`);
    
    try {
        const logs = await provider.getLogs({
            address: contractAddress,
            fromBlock: fromBlock,
            toBlock: toBlock,
            topics: [topic]
        });
        
        console.log(`Found ${logs.length} events with topic ${topic}`);
        return logs;
        
    } catch (error) {
        console.error(`Error fetching events: ${error.message}`);
        return [];
    }
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
            22770565 // last block with events
        );
        
        if (events.length === 0) {
            console.log("No DepositProcessed events found.");
            return;
        }
        
        console.log(`Found ${events.length} DepositProcessed events`);
        
        // Format events
        const formattedEvents = formatEvents(events);
        
        // Save to file
        saveEventsToFile(formattedEvents);
        
        // Print summary
        if (formattedEvents.length > 0) {
            console.log("\nEvent Summary:");
            console.log(`Total events: ${formattedEvents.length}`);
            
            // Show first few events
            console.log("\nFirst few events:");
            for (let i = 0; i < Math.min(3, formattedEvents.length); i++) {
                const event = formattedEvents[i];
                console.log(`  Event ${i + 1}:`);
                console.log(`    Asset: ${event.asset}`);
                console.log(`    User: ${event.user}`);
                console.log(`    Amount: ${event.amount}`);
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