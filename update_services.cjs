const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'services-data.js');
let content = fs.readFileSync(filepath, 'utf8');

const servicesRegex = /export const INITIAL_SERVICES = \[([\s\S]*?)\];/;
const match = content.match(servicesRegex);
if (match) {
  let itemsText = match[1];
  
  // A small trick is to just evaluate the array
  // Then regenerate the array text? That might lose comments.
  // Instead, let's use replace on each item block.
  
  // Match each object block
  let updatedItemsText = itemsText.replace(/{\s*id: '([^']+)'[\s\S]*?afterHoursAllowed: [truefalse]+,\s*}/g, (block, id) => {
    let days = 30;
    
    if (id.startsWith('AC-CLN')) days = 30;
    else if (id === 'OT-SES-02') days = 30;
    else if (id === 'AC-INS-02' || id === 'AC-INS-03') days = 180;
    else if (id.startsWith('AC-REP') || 
             id.startsWith('EL-EMG') || 
             id === 'EL-WHT-03' || 
             id.startsWith('OT-HDM') || 
             id === 'OT-SES-01' || 
             id === 'OT-SES-03' || 
             id.startsWith('BM-GEN') || 
             id === 'PL-PMP-01' || id === 'PL-PMP-02' ||
             id === 'PL-PIP-01' || id === 'PL-PIP-02' || id === 'PL-PIP-03' ||
             id === 'PL-SAN-01' || id === 'PL-SAN-02' || id === 'PL-SAN-03') days = 60;
    else days = 90; // All others (installations, painting, tiles) get 90
    
    // Some custom exceptions based on "ล้าง/ตรวจเช็ค: 30 วัน", AC-INS-01 is uninstall? Maybe 30 or 60. Let's make it 60.
    if (id === 'AC-INS-01') days = 60;
    if (id === 'PL-PMP-04') days = 30; // ล้างทำความสะอาดถังเก็บน้ำ

    let text = `${days} วัน`;
    
    // Insert before afterHoursAllowed or at the end
    return block.replace(/(\s*)(afterHoursAllowed: [a-z]+,)/, `$1warranty_days: ${days},$1warranty_text: '${text}',$1$2`);
  });
  
  content = content.replace(itemsText, updatedItemsText);
  fs.writeFileSync(filepath, content, 'utf8');
  console.log("Updated services-data.js");
}
