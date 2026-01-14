import Papa from 'papaparse';

export {};

const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'throwawaymail.com', '10minutemail.com', 'mailinator.com', 
  'guerrillamail.com', 'sharklasers.com', 'dispostable.com', 'yopmail.com'
]);

const ROLE_PREFIXES = [
  'admin', 'support', 'info', 'sales', 'hello', 'contact', 'billing', 'jobs',
  'marketing', 'office', 'webmaster', 'noreply', 'help', 'enquiry'
];

const PERSONAL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'protonmail.com', 'zoho.com', 'me.com', 'msn.com']);

const validateEmail = (email: string) => {
  const [localPart, domain] = email.toLowerCase().split('@');
  
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  const isRoleBased = ROLE_PREFIXES.some(prefix => localPart === prefix || localPart.startsWith(prefix + '.'));
  
  return { isDisposable, isRoleBased };
};

const analyzeDomain = (domain: string) => {
  const parts = domain.split('.');
  const tld = parts[parts.length - 1];
  const type = PERSONAL_DOMAINS.has(domain) ? 'Personal' : 'Corporate';
  return { tld, type };
};

self.onmessage = (e: MessageEvent) => {
  const { action, file, selectedColumn, text } = e.data;

  if (action === 'process') {
    const valid: any[] = [];
    const disposable: string[] = [];
    const roleBased: string[] = [];
    const invalid: string[] = [];
    const seenEmails = new Set<string>();

    const finalize = () => {
      self.postMessage({ 
        action: 'result', 
        results: { valid, disposable, roleBased, invalid } 
      });
    };

    if (file) {
      // Logic for File (CSV/TXT) - Parsing happens inside the worker
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        chunk: (results) => {
          results.data.forEach((row: any) => {
            const rawEmail = row[selectedColumn];
            if (!rawEmail) return;

            const email = String(rawEmail).toLowerCase().trim();
            if (seenEmails.has(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              if (email && !seenEmails.has(email)) invalid.push(email);
              return;
            }

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
        complete: finalize
      });
    } else if (text) {
      // Logic for pasted text
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const rawMatches = text.match(emailRegex) || [];
      
      rawMatches.forEach((email: string) => {
        const clean = email.toLowerCase().trim();
        if (seenEmails.has(clean)) return;
        seenEmails.add(clean);
        
        // Simplified object for raw text
        const domain = clean.split('@')[1];
        const { isDisposable, isRoleBased } = validateEmail(clean);
        const { tld, type } = analyzeDomain(domain);

        valid.push({ extractedEmail: clean, domain, tld, type, isDisposable, isRoleBased });
        if (isDisposable) disposable.push(clean);
        if (isRoleBased) roleBased.push(clean);
      });
      finalize();
    }
  }
};