import { config } from './config.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
const token = config.cfApiToken || process.env.CF_API_TOKEN;
const zoneId = config.cfZoneId || process.env.CF_ZONE_ID;
const accountId = config.cfAccountId || process.env.CF_ACCOUNT_ID;
const tunnelId = config.cfTunnelId || process.env.CF_TUNNEL_ID;

console.log('CF Zone ID:', zoneId);
console.log('CF Tunnel ID:', tunnelId);
console.log('CF Account ID:', accountId);

if (!token || !zoneId || !accountId || !tunnelId) {
    console.error('Missing required Cloudflare credentials');
    process.exit(1);
}

const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
};

async function fixStagingCloudflare() {
    console.log('\n--- 1. Checking Cloudflare DNS Records for staging.ragenodes.com ---');
    const dnsRes = await fetch(`${CF_API}/zones/${zoneId}/dns_records?name=staging.ragenodes.com`, { headers });
    const dnsData = await dnsRes.json();
    
    if (dnsData.success && dnsData.result && dnsData.result.length > 0) {
        console.log('CNAME record for staging.ragenodes.com already exists:', dnsData.result[0].id, '=>', dnsData.result[0].content);
    } else {
        console.log('Creating CNAME record for staging.ragenodes.com pointing to', `${tunnelId}.cfargotunnel.com`);
        const createDnsRes = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                type: 'CNAME',
                name: 'staging.ragenodes.com',
                content: `${tunnelId}.cfargotunnel.com`,
                ttl: 1,
                proxied: true
            })
        });
        const createDnsData = await createDnsRes.json();
        console.log('DNS creation result:', createDnsData.success, createDnsData.errors || '');
    }

    console.log('\n--- 2. Checking Cloudflare Tunnel Ingress Rules ---');
    const tunnelRes = await fetch(`${CF_API}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { headers });
    const tunnelData = await tunnelRes.json();

    if (!tunnelData.success) {
        console.error('Failed to fetch tunnel configuration:', tunnelData.errors);
        return;
    }

    const configData = tunnelData.result.config || {};
    const ingress = configData.ingress || [];
    console.log('Current Ingress Rules count:', ingress.length);

    let hasStagingRule = false;
    for (const rule of ingress) {
        if (rule.hostname === 'staging.ragenodes.com') {
            hasStagingRule = true;
            console.log('Existing staging rule:', rule);
            rule.service = 'http://192.168.1.106:80';
        }
    }

    if (!hasStagingRule) {
        console.log('Adding staging.ragenodes.com ingress rule to Cloudflare Tunnel...');
        const stagingRule = {
            hostname: 'staging.ragenodes.com',
            service: 'http://192.168.1.106:80'
        };
        const catchAll = ingress.pop();
        ingress.push(stagingRule);
        if (catchAll) ingress.push(catchAll);
    }

    configData.ingress = ingress;

    console.log('Saving updated Cloudflare Tunnel configuration...');
    const updateRes = await fetch(`${CF_API}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config: configData })
    });
    const updateData = await updateRes.json();
    console.log('Tunnel configuration update result:', updateData.success, updateData.errors || '');
}

fixStagingCloudflare().catch(console.error);
