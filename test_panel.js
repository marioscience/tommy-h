const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('/opt/ragenodes-ultimate/frontend/public/panel.html', 'utf8');
const js = fs.readFileSync('/opt/ragenodes-ultimate/frontend/public/js/panel.js', 'utf8');

const dom = new JSDOM(html, {
    url: "http://localhost/panel",
    runScripts: "dangerously",
    beforeParse(window) {
        // Mock Nexus API and localStorage
        window.localStorage = {
            getItem: (k) => k === 'nexus_user' ? JSON.stringify({role: 'admin', is_verified: true, email: 'test@test.com'}) : null,
            setItem: () => {}
        };
        window.Nexus = {
            api: async () => { return { items: [{ id: 'test1', template: 'fivem', status: 'running' }] } }
        };
        window.alert = console.log;
    }
});

const script = dom.window.document.createElement("script");
script.textContent = js;

try {
    dom.window.document.body.appendChild(script);
    console.log("Script loaded successfully without throwing.");
} catch (e) {
    console.error("Script threw an error upon loading:", e);
}

// wait for promises
setTimeout(() => {
    console.log("After timeout");
}, 2000);
