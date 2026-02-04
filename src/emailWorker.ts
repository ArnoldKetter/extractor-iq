import Papa from 'papaparse';

// Internal State for the Batch Session
let seenEmails = new Set<string>();
let valid: any[] = [];
let disposable: string[] = [];
let roleBased: string[] = [];
let invalid: string[] = [];
let stats = {
  totalRows: 0,
  duplicates: 0,
  syntaxErrors: 0,
};

// Configuration constants
const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'throwawaymail.com', '10minutemail.com', 'mailinator.com', 
  'guerrillamail.com', 'sharklasers.com', 'dispostable.com', 'yopmail.com'
]);

const ROLE_PREFIXES = [
  'admin', 'support', 'info', 'sales', 'hello', 'contact', 'billing', 'jobs',
  'marketing', 'office', 'webmaster', 'noreply', 'help', 'enquiry'
];

const validateEmail = (email: string) => {
  const [localPart, domain] = email.toLowerCase().split('@');
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  const isRoleBased = ROLE_PREFIXES.some(prefix => localPart === prefix || localPart.startsWith(prefix + '.'));
  return { isDisposable, isRoleBased };
};

const analyzeDomain = (domain: string) => {
  const PERSONAL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'protonmail.com', 'zoho.com', 'me.com', 'msn.com']);
  const parts = domain.split('.');
  const tld = parts[parts.length - 1];
  const type = PERSONAL_DOMAINS.has(domain) ? 'Personal' : 'Corporate';
  return { tld, type };
};

self.onmessage = (e: MessageEvent) => {
  const { action, file, selectedColumn, text } = e.data;

  // RESET ACTION: Clears memory for a new batch
  if (action === 'reset') {
    seenEmails.clear();
    valid = [];
    disposable = [];
    roleBased = [];
    invalid = [];
    stats = { totalRows: 0, duplicates: 0, syntaxErrors: 0 };
    self.postMessage({ action: 'reset_complete' });
    return;
  }

  // FINALIZE ACTION: Returns the aggregated results
  if (action === 'finalize') {
    self.postMessage({ 
      action: 'result', 
      results: { valid, disposable, roleBased, invalid, stats } 
    });
    return;
  }

  // PROCESS ACTION: Ingests a single file into the current session state
  if (action === 'process') {
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        chunk: (results) => {
          results.data.forEach((row: any) => {
            stats.totalRows++;
            const rawEmail = row[selectedColumn];
            
            if (!rawEmail) {
              stats.syntaxErrors++;
              return;
            }

            const email = String(rawEmail).toLowerCase().trim();

            // Check Deduplication
            if (seenEmails.has(email)) {
              stats.duplicates++;
              return;
            }

            // Check Syntax
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              invalid.push(email);
              stats.syntaxErrors++;
              return;
            }

            // If we are here, it's a new, valid email
            seenEmails.add(email);
            
            const domain = email.split('@')[1];
            const { isDisposable, isRoleBased } = validateEmail(email);
            const { tld, type } = analyzeDomain(domain);

            valid.push({
              ...row,
              extractedEmail: email,
              domain,
              tld,
              type,
              isDisposable,
              isRoleBased
            });

            if (isDisposable) disposable.push(email);
            if (isRoleBased) roleBased.push(email);
          });
        },
        complete: () => {
          // Notify main thread this specific file is done, but don't send all data yet
          self.postMessage({ action: 'file_complete', filename: file.name });
        }
      });
    } else if (text) {
      // Text logic (Simplified for batch context)
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const rawMatches = text.match(emailRegex) || [];
      
      rawMatches.forEach((email: string) => {
        stats.totalRows++;
        const clean = email.toLowerCase().trim();
        
        if (seenEmails.has(clean)) {
          stats.duplicates++;
          return;
        }
        
        seenEmails.add(clean);
        const domain = clean.split('@')[1];
        const { isDisposable, isRoleBased } = validateEmail(clean);
        const { tld, type } = analyzeDomain(domain);

        valid.push({ extractedEmail: clean, domain, tld, type, isDisposable, isRoleBased });
        if (isDisposable) disposable.push(clean);
        if (isRoleBased) roleBased.push(clean);
      });
      self.postMessage({ action: 'file_complete', filename: 'Raw Text' });
    }
  }
};