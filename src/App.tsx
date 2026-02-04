import React, { useState, useRef } from 'react';
import { FileText, Play, Trash2, BarChart3, Settings, Database, LayoutDashboard, Download, Clipboard, FilePlus } from 'lucide-react';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';

// --- Types ---
interface EmailRecord {
  extractedEmail: string;
  domain: string;
  tld: string;
  type: 'Personal' | 'Corporate';
  isDisposable: boolean;
  isRoleBased: boolean;
  [key: string]: any;
}

interface BatchStats {
  totalRows: number;
  duplicates: number;
  syntaxErrors: number;
}

interface ProcessingResults {
  valid: EmailRecord[];
  disposable: string[];
  roleBased: string[];
  invalid: string[];
  stats: BatchStats;
}

interface FileStage {
  id: string;
  file: File;
  columns: string[];
  selectedColumn: string;
  status: 'pending' | 'ready' | 'processing' | 'done';
}

// --- Components ---

const Sidebar = ({ activeView, setView }: { activeView: string, setView: (v: string) => void }) => (
  <div className="w-64 bg-black text-white h-screen flex flex-col border-r border-zinc-800 fixed left-0 top-0 z-50">
    <div className="p-6 border-b border-zinc-800">
      <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
        <div className="w-6 h-6 bg-white rounded-full"></div>
        OutBound IQ
      </h1>
      <span className="text-[10px] text-zinc-500 font-mono mt-1 block">v1.2.0-beta.1</span>
    </div>
    <nav className="flex-1 p-4 space-y-1">
      {[
        { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
        { id: 'import', label: 'Import Data', icon: Database },
        { id: 'results', label: 'Results', icon: BarChart3 },
        { id: 'settings', label: 'Settings', icon: Settings },
      ].map((item) => (
        <button
          key={item.id}
          onClick={() => setView(item.id)}
          className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            activeView === item.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
          }`}
        >
          <item.icon className="w-4 h-4" />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
    <div className="p-4 border-t border-zinc-800">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600"></div>
        <div>
          <p className="text-sm font-medium">Admin User</p>
          <p className="text-xs text-zinc-500">Pro Plan</p>
        </div>
      </div>
    </div>
  </div>
);

const MetricCard = ({ label, value, sub, colorClass }: { label: string, value: string | number, sub?: string, colorClass?: string }) => (
  <div className="bg-white border border-zinc-200 p-6 rounded-lg shadow-sm">
    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{label}</p>
    <p className={`text-3xl font-bold ${colorClass || 'text-zinc-900'}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
    {sub && <p className="text-xs text-zinc-400 mt-2">{sub}</p>}
  </div>
);

// --- Main App ---

const App: React.FC = () => {
  const [view, setView] = useState('import');
  const [stagedFiles, setStagedFiles] = useState<FileStage[]>([]);
  const [results, setResults] = useState<ProcessingResults | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Text Paste State
  const [importMode, setImportMode] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  
  // Table State
  const [filter, setFilter] = useState<'all' | 'corporate' | 'personal' | 'role'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Add File to Staging
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
  };

  const processFiles = (files: File[]) => {
    const newFiles: FileStage[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      columns: [],
      selectedColumn: '',
      status: 'pending'
    }));

    // Pre-scan for columns
    newFiles.forEach(f => {
      if (f.file.name.endsWith('.csv')) {
        Papa.parse(f.file, {
          header: true,
          preview: 1,
          complete: (res) => {
            if (res.meta.fields) {
              const cols = res.meta.fields;
              const emailCol = cols.find(c => c.toLowerCase().includes('email') || c.toLowerCase().includes('mail') || c.toLowerCase().includes('address')) || '';
              
              setStagedFiles(prev => prev.map(pf => pf.id === f.id ? { 
                ...pf, 
                columns: cols, 
                selectedColumn: emailCol,
                status: emailCol ? 'ready' : 'pending' 
              } : pf));
            }
          }
        });
      } else {
         setStagedFiles(prev => prev.map(pf => pf.id === f.id ? { ...pf, status: 'ready' } : pf));
      }
    });
    
    setStagedFiles(prev => [...prev, ...newFiles]);
  };

  // Convert Text to Virtual File
  const handleTextSubmit = () => {
    if (!pastedText.trim()) return;
    
    const virtualFile = new File([pastedText], `Manual_Input_${new Date().getTime()}.txt`, { type: "text/plain" });
    processFiles([virtualFile]);
    
    setPastedText(''); // Clear input
    setImportMode('upload'); // Switch back to list view to show it was added
  };

  const updateColumn = (id: string, col: string) => {
    setStagedFiles(prev => prev.map(f => f.id === id ? { ...f, selectedColumn: col, status: 'ready' } : f));
  };

  const removeFile = (id: string) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id));
  };

  const runBatchProcessing = async () => {
    setIsProcessing(true);
    setView('results');
    const worker = new Worker(new URL('./emailWorker.ts', import.meta.url), { type: 'module' });

    worker.postMessage({ action: 'reset' });

    const processFile = (stage: FileStage) => new Promise<void>((resolve) => {
      setStagedFiles(prev => prev.map(f => f.id === stage.id ? { ...f, status: 'processing' } : f));
      
      if (stage.file.name.endsWith('.csv')) {
        worker.postMessage({ action: 'process', file: stage.file, selectedColumn: stage.selectedColumn });
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          worker.postMessage({ action: 'process', text: e.target?.result });
        };
        reader.readAsText(stage.file);
      }

      const handler = (e: MessageEvent) => {
        if (e.data.action === 'file_complete') {
          setStagedFiles(prev => prev.map(f => f.id === stage.id ? { ...f, status: 'done' } : f));
          worker.removeEventListener('message', handler);
          resolve();
        }
      };
      worker.addEventListener('message', handler);
    });

    for (const file of stagedFiles) {
      await processFile(file);
    }

    worker.postMessage({ action: 'finalize' });
    worker.onmessage = (e) => {
      if (e.data.action === 'result') {
        setResults(e.data.results);
        setIsProcessing(false);
        worker.terminate();
      }
    };
  };

  const handleExport = () => {
    if (!results) return;
    const filtered = results.valid.filter(item => {
      if (filter === 'corporate') return item.type === 'Corporate';
      if (filter === 'personal') return item.type === 'Personal';
      if (filter === 'role') return item.isRoleBased;
      return true;
    });
    const csv = Papa.unparse(filtered);
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `batch_export_${new Date().getTime()}.csv`);
  };

  // --- Views ---

  const ImportView = () => (
    <div className="max-w-4xl mx-auto pt-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Import Data</h2>
          <p className="text-zinc-500">Upload multiple CSV/TXT files or paste raw text to create a unified batch.</p>
        </div>
        
        {/* Toggle Switch */}
        <div className="bg-zinc-200 p-1 rounded-lg flex space-x-1">
          <button 
            onClick={() => setImportMode('upload')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${importMode === 'upload' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            File Upload
          </button>
          <button 
            onClick={() => setImportMode('paste')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${importMode === 'paste' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Paste Text
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm min-h-[400px]">
        {importMode === 'upload' ? (
          <>
            {stagedFiles.length === 0 ? (
              <div className="p-20 text-center text-zinc-400">
                 <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Database className="w-8 h-8 text-zinc-300" />
                 </div>
                 <p className="font-medium">No files staged for processing</p>
                 <button 
                   onClick={() => fileInputRef.current?.click()}
                   className="mt-4 text-blue-600 font-medium hover:underline flex items-center justify-center mx-auto"
                 >
                   <FilePlus className="w-4 h-4 mr-2" />
                   Browse Files
                 </button>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {stagedFiles.map((file) => (
                  <div key={file.id} className="p-4 flex items-center justify-between group hover:bg-zinc-50 transition-colors">
                    <div className="flex items-center space-x-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${file.file.type === 'text/plain' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                        {file.file.type === 'text/plain' ? <Clipboard className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-zinc-900">{file.file.name}</p>
                        <p className="text-xs text-zinc-500">{(file.file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4">
                      {file.file.name.endsWith('.csv') && (
                        <div className="flex items-center space-x-2">
                           <span className="text-xs font-medium text-zinc-400">Map Email:</span>
                           <select 
                             value={file.selectedColumn}
                             onChange={(e) => updateColumn(file.id, e.target.value)}
                             className={`text-xs border rounded p-1.5 outline-none focus:ring-1 focus:ring-blue-500 ${!file.selectedColumn ? 'border-red-300 bg-red-50 text-red-600' : 'border-zinc-300'}`}
                           >
                             <option value="">Select Column...</option>
                             {file.columns.map(c => <option key={c} value={c}>{c}</option>)}
                           </select>
                        </div>
                      )}
                      <button onClick={() => removeFile(file.id)} className="p-2 text-zinc-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                
                <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex justify-center">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm font-medium text-zinc-600 hover:text-black flex items-center"
                  >
                    <FilePlus className="w-4 h-4 mr-2" /> Add More Files
                  </button>
                </div>
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv,.txt" multiple className="hidden" />
          </>
        ) : (
          <div className="flex flex-col h-[400px]">
            <div className="p-4 border-b border-zinc-100 bg-zinc-50">
              <h3 className="text-sm font-bold text-zinc-700">Manual Input</h3>
              <p className="text-xs text-zinc-500">Paste raw text containing emails. We'll treat this as a .txt file.</p>
            </div>
            <textarea 
              className="flex-1 p-4 outline-none resize-none text-sm font-mono text-zinc-700"
              placeholder="e.g. john@doe.com, jane@agency.net..."
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
            <div className="p-4 border-t border-zinc-100 flex justify-end bg-zinc-50">
              <button 
                onClick={handleTextSubmit}
                disabled={!pastedText.trim()}
                className="bg-black text-white px-6 py-2 rounded-md text-sm font-bold hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                Add to Batch
              </button>
            </div>
          </div>
        )}
      </div>

      {stagedFiles.length > 0 && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={runBatchProcessing}
            disabled={isProcessing || stagedFiles.some(f => f.file.name.endsWith('.csv') && !f.selectedColumn)}
            className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-bold transition-all ${
              isProcessing ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
            }`}
          >
            {isProcessing ? (
               <><span>Processing Batch...</span></>
            ) : (
               <>
                 <Play className="w-4 h-4 fill-current" />
                 <span>Process {stagedFiles.length} Sources</span>
               </>
            )}
          </button>
        </div>
      )}
    </div>
  );

  const ResultsView = () => {
    if (!results) return (
        <div className="h-full flex flex-col items-center justify-center text-zinc-400">
            <BarChart3 className="w-12 h-12 mb-4 opacity-20" />
            <p>No results yet. Import and process data first.</p>
            <button onClick={() => setView('import')} className="mt-4 text-blue-600 font-medium hover:underline">Go to Import</button>
        </div>
    );

    const filteredData = results.valid.filter(item => {
        if (filter === 'corporate') return item.type === 'Corporate';
        if (filter === 'personal') return item.type === 'Personal';
        if (filter === 'role') return item.isRoleBased;
        return true;
    });

    return (
      <div className="max-w-6xl mx-auto pt-10 pb-20">
        <div className="flex items-center justify-between mb-8">
           <h2 className="text-2xl font-bold text-zinc-900">Batch Intelligence Report</h2>
           <div className="flex space-x-2">
             <button onClick={handleExport} className="flex items-center space-x-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-bold">
               <Download className="w-4 h-4" /> <span>Export Valid</span>
             </button>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
           <MetricCard label="Raw Rows Imported" value={results.stats.totalRows} colorClass="text-zinc-600" />
           <div className="flex flex-col space-y-4 justify-center">
             <div className="bg-red-50 border border-red-100 p-3 rounded-lg flex justify-between items-center">
                <span className="text-xs font-bold text-red-600 uppercase">Removed (Dupes)</span>
                <span className="font-mono font-bold text-red-700">-{results.stats.duplicates.toLocaleString()}</span>
             </div>
             <div className="bg-orange-50 border border-orange-100 p-3 rounded-lg flex justify-between items-center">
                <span className="text-xs font-bold text-orange-600 uppercase">Removed (Syntax)</span>
                <span className="font-mono font-bold text-orange-700">-{results.stats.syntaxErrors}</span>
             </div>
           </div>
           <MetricCard label="Final Unique Leads" value={results.valid.length} colorClass="text-blue-600" sub="100% Valid Syntax" />
           <MetricCard label="High-Value (Corp)" value={results.valid.filter(r => r.type === 'Corporate' && !r.isRoleBased).length} colorClass="text-green-600" sub="Non-Role Corporate" />
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
           <div className="border-b border-zinc-200 p-4 bg-zinc-50 flex items-center justify-between">
              <div className="flex space-x-1">
                 {['all', 'corporate', 'personal', 'role'].map(f => (
                   <button 
                     key={f}
                     onClick={() => { setFilter(f as any); setCurrentPage(1); }}
                     className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${filter === f ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-200'}`}
                   >
                     {f}
                   </button>
                 ))}
              </div>
              <span className="text-xs text-zinc-500 font-medium">Showing {filteredData.length} records</span>
           </div>

           <div className="overflow-x-auto">
             <table className="w-full text-left">
               <thead className="bg-white border-b border-zinc-200">
                 <tr>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase">Email Address</th>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase">Domain</th>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase">Classification</th>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase text-right">Flags</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-zinc-100 text-sm">
                 {filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((item, idx) => (
                   <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                     <td className="px-6 py-3 font-medium text-zinc-900">{item.extractedEmail}</td>
                     <td className="px-6 py-3 text-zinc-500">{item.domain}</td>
                     <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          item.type === 'Personal' ? 'bg-zinc-100 text-zinc-600' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {item.type}
                        </span>
                     </td>
                     <td className="px-6 py-3 text-right">
                       <div className="flex justify-end space-x-1">
                        {item.isRoleBased && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold">ROLE</span>}
                        {item.isDisposable && <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">BURNER</span>}
                       </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
           
           <div className="p-4 border-t border-zinc-200 flex justify-between items-center bg-zinc-50">
             <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="text-xs font-bold text-zinc-500 hover:text-zinc-900 disabled:opacity-30">Previous</button>
             <span className="text-xs text-zinc-400">Page {currentPage}</span>
             <button disabled={currentPage * pageSize >= filteredData.length} onClick={() => setCurrentPage(p => p + 1)} className="text-xs font-bold text-zinc-500 hover:text-zinc-900 disabled:opacity-30">Next</button>
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <Sidebar activeView={view} setView={setView} />
      <main className="flex-1 ml-64 p-8 overflow-y-auto h-screen">
        {view === 'dashboard' && (
           <div className="flex flex-col items-center justify-center h-full text-center">
             <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-2xl mb-6 shadow-xl shadow-blue-200 flex items-center justify-center">
                <Database className="w-10 h-10 text-white" />
             </div>
             <h1 className="text-4xl font-black text-zinc-900 mb-4 tracking-tight">Email Intelligence Suite</h1>
             <p className="text-zinc-500 max-w-md mb-8">Process, deduplicate, and analyze unlimited email lists locally. Your data never leaves this browser.</p>
             <button onClick={() => setView('import')} className="bg-black text-white px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform">Start New Batch</button>
           </div>
        )}
        {view === 'import' && <ImportView />}
        {view === 'results' && <ResultsView />}
      </main>
    </div>
  );
};

export default App;

  // Convert Text to Virtual File
  const handleTextSubmit = () => {
    if (!pastedText.trim()) return;
    
    const virtualFile = new File([pastedText], `Manual_Input_${new Date().getTime()}.txt`, { type: "text/plain" });
    processFiles([virtualFile]);
    
    setPastedText(''); // Clear input
    setImportMode('upload'); // Switch back to list view to show it was added
  };

  const updateColumn = (id: string, col: string) => {
    setStagedFiles(prev => prev.map(f => f.id === id ? { ...f, selectedColumn: col, status: 'ready' } : f));
  };

  const removeFile = (id: string) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id));
  };

  const runBatchProcessing = async () => {
    setIsProcessing(true);
    setView('results');
    const worker = new Worker(new URL('./emailWorker.ts', import.meta.url), { type: 'module' });

    worker.postMessage({ action: 'reset' });

    const processFile = (stage: FileStage) => new Promise<void>((resolve) => {
      setStagedFiles(prev => prev.map(f => f.id === stage.id ? { ...f, status: 'processing' } : f));
      
      if (stage.file.name.endsWith('.csv')) {
        worker.postMessage({ action: 'process', file: stage.file, selectedColumn: stage.selectedColumn });
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          worker.postMessage({ action: 'process', text: e.target?.result });
        };
        reader.readAsText(stage.file);
      }

      const handler = (e: MessageEvent) => {
        if (e.data.action === 'file_complete') {
          setStagedFiles(prev => prev.map(f => f.id === stage.id ? { ...f, status: 'done' } : f));
          worker.removeEventListener('message', handler);
          resolve();
        }
      };
      worker.addEventListener('message', handler);
    });

    for (const file of stagedFiles) {
      await processFile(file);
    }

    worker.postMessage({ action: 'finalize' });
    worker.onmessage = (e) => {
      if (e.data.action === 'result') {
        setResults(e.data.results);
        setIsProcessing(false);
        worker.terminate();
      }
    };
  };

  const handleExport = () => {
    if (!results) return;
    const filtered = results.valid.filter(item => {
      if (filter === 'corporate') return item.type === 'Corporate';
      if (filter === 'personal') return item.type === 'Personal';
      if (filter === 'role') return item.isRoleBased;
      return true;
    });
    const csv = Papa.unparse(filtered);
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `batch_export_${new Date().getTime()}.csv`);
  };

  // --- Views ---

  const ImportView = () => (
    <div className="max-w-4xl mx-auto pt-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Import Data</h2>
          <p className="text-zinc-500">Upload multiple CSV/TXT files or paste raw text to create a unified batch.</p>
        </div>
        
        {/* Toggle Switch */}
        <div className="bg-zinc-200 p-1 rounded-lg flex space-x-1">
          <button 
            onClick={() => setImportMode('upload')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${importMode === 'upload' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            File Upload
          </button>
          <button 
            onClick={() => setImportMode('paste')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${importMode === 'paste' ? 'bg-white shadow-sm text-black' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Paste Text
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm min-h-[400px]">
        {importMode === 'upload' ? (
          <>
            {stagedFiles.length === 0 ? (
              <div className="p-20 text-center text-zinc-400">
                 <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Database className="w-8 h-8 text-zinc-300" />
                 </div>
                 <p className="font-medium">No files staged for processing</p>
                 <button 
                   onClick={() => fileInputRef.current?.click()}
                   className="mt-4 text-blue-600 font-medium hover:underline flex items-center justify-center mx-auto"
                 >
                   <FilePlus className="w-4 h-4 mr-2" />
                   Browse Files
                 </button>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {stagedFiles.map((file) => (
                  <div key={file.id} className="p-4 flex items-center justify-between group hover:bg-zinc-50 transition-colors">
                    <div className="flex items-center space-x-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${file.file.type === 'text/plain' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                        {file.file.type === 'text/plain' ? <Clipboard className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-zinc-900">{file.file.name}</p>
                        <p className="text-xs text-zinc-500">{(file.file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4">
                      {file.file.name.endsWith('.csv') && (
                        <div className="flex items-center space-x-2">
                           <span className="text-xs font-medium text-zinc-400">Map Email:</span>
                           <select 
                             value={file.selectedColumn}
                             onChange={(e) => updateColumn(file.id, e.target.value)}
                             className={`text-xs border rounded p-1.5 outline-none focus:ring-1 focus:ring-blue-500 ${!file.selectedColumn ? 'border-red-300 bg-red-50 text-red-600' : 'border-zinc-300'}`}
                           >
                             <option value="">Select Column...</option>
                             {file.columns.map(c => <option key={c} value={c}>{c}</option>)}
                           </select>
                        </div>
                      )}
                      <button onClick={() => removeFile(file.id)} className="p-2 text-zinc-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                
                <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex justify-center">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm font-medium text-zinc-600 hover:text-black flex items-center"
                  >
                    <FilePlus className="w-4 h-4 mr-2" /> Add More Files
                  </button>
                </div>
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv,.txt" multiple className="hidden" />
          </>
        ) : (
          <div className="flex flex-col h-[400px]">
            <div className="p-4 border-b border-zinc-100 bg-zinc-50">
              <h3 className="text-sm font-bold text-zinc-700">Manual Input</h3>
              <p className="text-xs text-zinc-500">Paste raw text containing emails. We'll treat this as a .txt file.</p>
            </div>
            <textarea 
              className="flex-1 p-4 outline-none resize-none text-sm font-mono text-zinc-700"
              placeholder="e.g. john@doe.com, jane@agency.net..."
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
            <div className="p-4 border-t border-zinc-100 flex justify-end bg-zinc-50">
              <button 
                onClick={handleTextSubmit}
                disabled={!pastedText.trim()}
                className="bg-black text-white px-6 py-2 rounded-md text-sm font-bold hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                Add to Batch
              </button>
            </div>
          </div>
        )}
      </div>

      {stagedFiles.length > 0 && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={runBatchProcessing}
            disabled={isProcessing || stagedFiles.some(f => f.file.name.endsWith('.csv') && !f.selectedColumn)}
            className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-bold transition-all ${
              isProcessing ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
            }`}
          >
            {isProcessing ? (
               <><span>Processing Batch...</span></>
            ) : (
               <>
                 <Play className="w-4 h-4 fill-current" />
                 <span>Process {stagedFiles.length} Sources</span>
               </>
            )}
          </button>
        </div>
      )}
    </div>
  );

  const ResultsView = () => {
    if (!results) return (
        <div className="h-full flex flex-col items-center justify-center text-zinc-400">
            <BarChart3 className="w-12 h-12 mb-4 opacity-20" />
            <p>No results yet. Import and process data first.</p>
            <button onClick={() => setView('import')} className="mt-4 text-blue-600 font-medium hover:underline">Go to Import</button>
        </div>
    );

    const filteredData = results.valid.filter(item => {
        if (filter === 'corporate') return item.type === 'Corporate';
        if (filter === 'personal') return item.type === 'Personal';
        if (filter === 'role') return item.isRoleBased;
        return true;
    });

    return (
      <div className="max-w-6xl mx-auto pt-10 pb-20">
        <div className="flex items-center justify-between mb-8">
           <h2 className="text-2xl font-bold text-zinc-900">Batch Intelligence Report</h2>
           <div className="flex space-x-2">
             <button onClick={handleExport} className="flex items-center space-x-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-bold">
               <Download className="w-4 h-4" /> <span>Export Valid</span>
             </button>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">
           <MetricCard label="Raw Rows Imported" value={results.stats.totalRows} colorClass="text-zinc-600" />
           <div className="flex flex-col space-y-4 justify-center">
             <div className="bg-red-50 border border-red-100 p-3 rounded-lg flex justify-between items-center">
                <span className="text-xs font-bold text-red-600 uppercase">Removed (Dupes)</span>
                <span className="font-mono font-bold text-red-700">-{results.stats.duplicates.toLocaleString()}</span>
             </div>
             <div className="bg-orange-50 border border-orange-100 p-3 rounded-lg flex justify-between items-center">
                <span className="text-xs font-bold text-orange-600 uppercase">Removed (Syntax)</span>
                <span className="font-mono font-bold text-orange-700">-{results.stats.syntaxErrors}</span>
             </div>
           </div>
           <MetricCard label="Final Unique Leads" value={results.valid.length} colorClass="text-blue-600" sub="100% Valid Syntax" />
           <MetricCard label="High-Value (Corp)" value={results.valid.filter(r => r.type === 'Corporate' && !r.isRoleBased).length} colorClass="text-green-600" sub="Non-Role Corporate" />
        </div>

        <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
           <div className="border-b border-zinc-200 p-4 bg-zinc-50 flex items-center justify-between">
              <div className="flex space-x-1">
                 {['all', 'corporate', 'personal', 'role'].map(f => (
                   <button 
                     key={f}
                     onClick={() => { setFilter(f as any); setCurrentPage(1); }}
                     className={`px-3 py-1.5 rounded text-xs font-bold uppercase transition-all ${filter === f ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-200'}`}
                   >
                     {f}
                   </button>
                 ))}
              </div>
              <span className="text-xs text-zinc-500 font-medium">Showing {filteredData.length} records</span>
           </div>

           <div className="overflow-x-auto">
             <table className="w-full text-left">
               <thead className="bg-white border-b border-zinc-200">
                 <tr>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase">Email Address</th>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase">Domain</th>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase">Classification</th>
                   <th className="px-6 py-3 text-xs font-bold text-zinc-400 uppercase text-right">Flags</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-zinc-100 text-sm">
                 {filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((item, idx) => (
                   <tr key={idx} className="hover:bg-zinc-50 transition-colors">
                     <td className="px-6 py-3 font-medium text-zinc-900">{item.extractedEmail}</td>
                     <td className="px-6 py-3 text-zinc-500">{item.domain}</td>
                     <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          item.type === 'Personal' ? 'bg-zinc-100 text-zinc-600' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {item.type}
                        </span>
                     </td>
                     <td className="px-6 py-3 text-right">
                       <div className="flex justify-end space-x-1">
                        {item.isRoleBased && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold">ROLE</span>}
                        {item.isDisposable && <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">BURNER</span>}
                       </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
           
           <div className="p-4 border-t border-zinc-200 flex justify-between items-center bg-zinc-50">
             <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="text-xs font-bold text-zinc-500 hover:text-zinc-900 disabled:opacity-30">Previous</button>
             <span className="text-xs text-zinc-400">Page {currentPage}</span>
             <button disabled={currentPage * pageSize >= filteredData.length} onClick={() => setCurrentPage(p => p + 1)} className="text-xs font-bold text-zinc-500 hover:text-zinc-900 disabled:opacity-30">Next</button>
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <Sidebar activeView={view} setView={setView} />
      <main className="flex-1 ml-64 p-8 overflow-y-auto h-screen">
        {view === 'dashboard' && (
           <div className="flex flex-col items-center justify-center h-full text-center">
             <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-2xl mb-6 shadow-xl shadow-blue-200 flex items-center justify-center">
                <Database className="w-10 h-10 text-white" />
             </div>
             <h1 className="text-4xl font-black text-zinc-900 mb-4 tracking-tight">Email Intelligence Suite</h1>
             <p className="text-zinc-500 max-w-md mb-8">Process, deduplicate, and analyze unlimited email lists locally. Your data never leaves this browser.</p>
             <button onClick={() => setView('import')} className="bg-black text-white px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform">Start New Batch</button>
           </div>
        )}
        {view === 'import' && <ImportView />}
        {view === 'results' && <ResultsView />}
      </main>
    </div>
  );
};

export default App;
