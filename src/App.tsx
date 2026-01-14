import React, { useState, useRef } from 'react';
import { Upload, FileText, X, ListFilter, Download } from 'lucide-react';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';

interface EmailRecord {
  extractedEmail: string;
  domain: string;
  tld: string;
  type: 'Personal' | 'Corporate';
  isDisposable: boolean;
  isRoleBased: boolean;
  [key: string]: any;
}

interface ProcessingResults {
  valid: EmailRecord[];
  disposable: string[];
  roleBased: string[];
  invalid: string[];
}

interface AuditEntry {
  timestamp: string;
  filename: string;
  total: number;
  unique: number;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [results, setResults] = useState<ProcessingResults | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [filter, setFilter] = useState<'all' | 'corporate' | 'personal' | 'role'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const pageSize = 15;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (selectedFile: File) => {
    setFile(selectedFile);
    if (selectedFile.name.endsWith('.csv')) {
      Papa.parse(selectedFile, {
        header: true,
        preview: 1,
        complete: (parseResults: Papa.ParseResult<any>) => {
          if (parseResults.meta.fields) {
            setColumns(parseResults.meta.fields);
            const emailCol = parseResults.meta.fields.find(f => 
              f.toLowerCase().includes('email') || f.toLowerCase().includes('mail')
            );
            if (emailCol) setSelectedColumn(emailCol);
          }
        },
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  };

  const processData = () => {
    if (activeTab === 'upload' && !file) return;
    if (activeTab === 'paste' && !pastedText) return;

    setIsProcessing(true);
    const worker = new Worker(new URL('./emailWorker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e: MessageEvent) => {
      setResults(e.data.results);
      setIsProcessing(false);
      
      setAuditLog(prev => [{
        timestamp: new Date().toLocaleTimeString(),
        filename: file?.name || 'Pasted Text',
        total: e.data.results.valid.length + e.data.results.invalid.length,
        unique: e.data.results.valid.length
      }, ...prev]);

      worker.terminate();
    };

    if (activeTab === 'paste') {
      worker.postMessage({ action: 'process', text: pastedText });
    } else {
      // CRITICAL: We pass the 'file' reference, NOT the parsed 'data'
      worker.postMessage({ 
        action: 'process', 
        file: file, 
        selectedColumn: selectedColumn 
      });
    }
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
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `export_${filter}.csv`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      <header className="bg-white border-b border-slate-200 px-6 py-4 mb-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-black text-blue-600 tracking-tighter uppercase">OutBound IQ</h1>
          <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded">V1.1 STABLE</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6">
        <div className="flex space-x-2 mb-8 bg-slate-200 p-1 rounded-xl">
          {(['upload', 'paste'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all uppercase ${activeTab === tab ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'upload' ? (
          <div className="space-y-4">
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'}`}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv,.txt" className="hidden" />
              {!file ? (
                <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center mx-auto group">
                  <Upload className="w-12 h-12 text-slate-300 group-hover:text-blue-500 transition-colors mb-4" />
                  <span className="text-sm font-bold text-slate-500">Drop CSV/TXT or click to browse</span>
                </button>
              ) : (
                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex items-center space-x-4">
                    <FileText className="w-6 h-6 text-blue-500" />
                    <span className="font-bold text-sm">{file.name}</span>
                  </div>
                  <button onClick={() => { setFile(null); setColumns([]); setSelectedColumn(''); }}><X className="w-5 h-5 text-slate-400" /></button>
                </div>
              )}
            </div>
            {columns.length > 0 && (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center space-x-2 mb-4">
                  <ListFilter className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">Target Column</span>
                </div>
                <select 
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedColumn}
                  onChange={(e) => setSelectedColumn(e.target.value)}
                >
                  <option value="">Select Column</option>
                  {columns.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <textarea 
              className="w-full h-64 p-6 outline-none resize-none font-mono text-xs leading-relaxed"
              placeholder="Paste raw text here..."
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
          </div>
        )}

        <button
          onClick={processData}
          disabled={isProcessing || (activeTab === 'upload' && !file) || (activeTab === 'paste' && !pastedText)}
          className={`w-full mt-6 py-4 rounded-2xl font-black uppercase tracking-widest transition-all ${isProcessing ? 'bg-slate-200 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'}`}
        >
          {isProcessing ? 'Analyzing...' : 'Execute Intelligence'}
        </button>

        {results && (
          <div className="mt-12 space-y-8 animate-in fade-in duration-500">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Unique" value={results.valid.length} color="text-slate-900" />
              <StatCard label="Role-Based" value={results.roleBased.length} color="text-purple-600" />
              <StatCard label="Disposable" value={results.disposable.length} color="text-orange-600" />
              <StatCard label="Invalid" value={results.invalid.length} color="text-red-600" />
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                <div className="flex space-x-1">
                  {(['all', 'corporate', 'personal', 'role'] as const).map(f => (
                    <button key={f} onClick={() => { setFilter(f); setCurrentPage(1); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all ${filter === f ? 'bg-blue-600 text-white' : 'hover:bg-slate-200 text-slate-500'}`}>{f}</button>
                  ))}
                </div>
                <button onClick={handleExport} className="flex items-center space-x-2 px-4 py-1.5 bg-green-600 text-white rounded-lg text-[10px] font-black uppercase"><Download className="w-3 h-3" /><span>Export</span></button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Email</th>
                      {columns.filter(c => c !== selectedColumn).slice(0, 4).map(c => <th key={c} className="px-6 py-3">{c}</th>)}
                      <th className="px-6 py-3 text-right">Classification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium">
                    {results.valid
                      .filter(item => filter === 'all' || (filter === 'corporate' && item.type === 'Corporate') || (filter === 'personal' && item.type === 'Personal') || (filter === 'role' && item.isRoleBased))
                      .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                      .map((item, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-slate-900">{item.extractedEmail}</td>
                          {columns.filter(c => c !== selectedColumn).slice(0, 4).map(c => <td key={c} className="px-6 py-4 text-slate-400">{item[c] || '-'}</td>)}
                          <td className="px-6 py-4 text-right">
                            <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${item.type === 'Personal' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{item.type}</span>
                            {item.isRoleBased && <span className="ml-1 bg-purple-100 text-purple-700 px-2 py-1 rounded text-[9px] font-black uppercase">Role</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/30">
                <span className="text-[10px] font-bold text-slate-400">Page {currentPage}</span>
                <div className="flex space-x-2">
                  <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-[10px] font-black disabled:opacity-30">PREV</button>
                  <button onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-[10px] font-black">NEXT</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {auditLog.length > 0 && (
          <div className="mt-16 pt-8 border-t border-slate-200">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Session Audit Log</h4>
            <div className="space-y-2">
              {auditLog.map((log, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl text-[10px] font-bold">
                  <span className="text-slate-400 font-mono">{log.timestamp}</span>
                  <span className="flex-1 px-4 truncate">{log.filename}</span>
                  <span className="text-blue-600">{log.unique.toLocaleString()} Extracted</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{label}</p>
    <p className={`text-3xl font-black ${color}`}>{value.toLocaleString()}</p>
  </div>
);

export default App;
