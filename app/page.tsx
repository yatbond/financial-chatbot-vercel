'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, Bot, User, FileSpreadsheet, TrendingUp, DollarSign, Calendar, Building2, ChevronDown, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ProjectInfo {
  code: string
  name: string
  year: string
  month: string
  filename: string
}

interface FolderStructure {
  [year: string]: string[]
}

interface Metrics {
  'Business Plan GP': number
  'Projected GP': number
  'WIP GP': number
  'Cash Flow': number
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "👋 Hi! I'm your financial assistant. Select a year/month and project to start querying data.\n\nTry asking:\n- 'What is the gross profit?'\n- 'Show projected gp'\n- 'Monthly materials for [month]'\n- 'Cash flow breakdown'"
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingStructure, setIsLoadingStructure] = useState(true)
  const [isLoadingProject, setIsLoadingProject] = useState(false)

  // Selection state
  const [folders, setFolders] = useState<FolderStructure>({})
  const [projects, setProjects] = useState<Record<string, ProjectInfo>>({})
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [availableProjects, setAvailableProjects] = useState<ProjectInfo[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load folder structure on mount
  useEffect(() => {
    loadStructure()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Update available projects when year/month changes
  useEffect(() => {
    if (selectedYear && selectedMonth) {
      const filtered = Object.values(projects).filter(
        p => p.year === selectedYear && p.month === selectedMonth
      )
      setAvailableProjects(filtered)
      setSelectedProject('')
      setSelectedFile('')
      setMetrics(null)
    }
  }, [selectedYear, selectedMonth, projects])

  const loadStructure = async () => {
    setIsLoadingStructure(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getStructure' })
      })
      const data = await res.json()
      
      if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ **Error connecting to Google Drive:**\n\n${data.error}\n\n**Check:**\n1. Environment variable GOOGLE_CREDENTIALS is set\n2. Google Drive API is enabled\n3. "Ai Chatbot Knowledge Base" folder is shared with service account`
        }])
      }
      
      setFolders(data.folders)
      setProjects(data.projects)

      // Set defaults to latest
      const years = Object.keys(data.folders || {}).sort().reverse()
      if (years.length > 0) {
        setSelectedYear(years[0])
        const months = data.folders[years[0]].sort((a: string, b: string) => parseInt(b) - parseInt(a))
        if (months.length > 0) {
          setSelectedMonth(months[0])
        }
      } else if (!data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ No data found. Make sure:\n1. Folder "Ai Chatbot Knowledge Base" exists in Google Drive\n2. It contains subfolders with years (e.g., 2025)\n3. Each year folder contains month folders with _flat.csv files'
        }])
      }
    } catch (error) {
      console.error('Error loading structure:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ **Connection Error:** ${error}`
      }])
    } finally {
      setIsLoadingStructure(false)
    }
  }

  const loadProject = async () => {
    if (!selectedProject || !selectedFile || !selectedYear || !selectedMonth) return

    setIsLoadingProject(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'loadProject',
          year: selectedYear,
          month: selectedMonth,
          project: selectedProject,
          projectFile: selectedFile
        })
      })
      const data = await res.json()
      setMetrics(data.metrics)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Loaded **${selectedProject}**\n\n**Key Metrics ('000):**\n- Business Plan GP: $${data.metrics['Business Plan GP'].toLocaleString()}\n- Projected GP: $${data.metrics['Projected GP'].toLocaleString()}\n- WIP GP: $${data.metrics['WIP GP'].toLocaleString()}\n- Cash Flow: $${data.metrics['Cash Flow'].toLocaleString()}`
      }])
    } catch (error) {
      console.error('Error loading project:', error)
    } finally {
      setIsLoadingProject(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading || !selectedProject) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'query',
          year: selectedYear,
          month: selectedMonth,
          project: selectedProject,
          projectFile: selectedFile,
          question: userMessage
        })
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])

      // Refresh metrics after query
      const metricsRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'metrics',
          year: selectedYear,
          month: selectedMonth,
          project: selectedProject,
          projectFile: selectedFile
        })
      })
      const metricsData = await metricsRes.json()
      setMetrics(metricsData.metrics)

    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleProjectSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const projectName = e.target.value
    setSelectedProject(projectName)

    const found = availableProjects.find(p => `${p.code} - ${p.name}` === projectName)
    if (found) {
      setSelectedFile(found.filename)
      loadProject()
    }
  }

  if (isLoadingStructure) {
    return (
      <main className="flex h-screen bg-gradient-to-br from-slate-900 to-slate-800 items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Connecting to Google Drive...</p>
          <p className="text-slate-500 text-sm mt-2">If this takes too long, check:</p>
          <ul className="text-slate-500 text-sm mt-2 text-left list-disc list-inside">
            <li>GOOGLE_CREDENTIALS env var is set</li>
            <li>Google Drive API is enabled</li>
            <li>Folder is shared with service account</li>
          </ul>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Sidebar */}
      <aside className="w-80 bg-slate-800/50 border-r border-slate-700 p-6 flex flex-col overflow-y-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileSpreadsheet className="w-8 h-8 text-blue-400" />
            Financial Bot
          </h1>
          <p className="text-slate-400 text-sm mt-2">Construction Finance AI</p>
        </div>

        {/* Year/Month Selection */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white mt-1 focus:outline-none focus:border-blue-500"
            >
              {Object.keys(folders).sort().reverse().map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white mt-1 focus:outline-none focus:border-blue-500"
            >
              {folders[selectedYear]?.sort((a, b) => parseInt(b) - parseInt(a)).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider">Project</label>
            <select
              value={selectedProject}
              onChange={handleProjectSelect}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white mt-1 focus:outline-none focus:border-blue-500"
              disabled={isLoadingProject}
            >
              <option value="">-- Select a project --</option>
              {availableProjects
                .sort((a, b) => parseInt(a.code) - parseInt(b.code))
                .map(p => (
                  <option key={p.filename} value={`${p.code} - ${p.name}`}>
                    {p.code} - {p.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Metrics Display */}
        {metrics && (
          <div className="bg-slate-700/50 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 text-slate-300 mb-3">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Key Metrics ('000)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-600/50 rounded-lg p-2">
                <div className="text-xs text-slate-400">Business Plan GP</div>
                <div className="text-lg font-bold text-green-400">${metrics['Business Plan GP'].toLocaleString()}</div>
              </div>
              <div className="bg-slate-600/50 rounded-lg p-2">
                <div className="text-xs text-slate-400">Projected GP</div>
                <div className="text-lg font-bold text-blue-400">${metrics['Projected GP'].toLocaleString()}</div>
              </div>
              <div className="bg-slate-600/50 rounded-lg p-2">
                <div className="text-xs text-slate-400">WIP GP</div>
                <div className="text-lg font-bold text-purple-400">${metrics['WIP GP'].toLocaleString()}</div>
              </div>
              <div className="bg-slate-600/50 rounded-lg p-2">
                <div className="text-xs text-slate-400">Cash Flow</div>
                <div className="text-lg font-bold text-yellow-400">${metrics['Cash Flow'].toLocaleString()}</div>
              </div>
            </div>
          </div>
        )}

        {/* Sample Queries */}
        {selectedProject && (
          <div className="bg-slate-700/50 rounded-xl p-4 mt-auto">
            <div className="flex items-center gap-2 text-slate-300 mb-2">
              <Bot className="w-4 h-4" />
              <span className="text-sm font-medium">Try asking:</span>
            </div>
            <ul className="text-xs text-slate-400 space-y-1">
              <li>• "What is the gross profit?"</li>
              <li>• "Show projected gp"</li>
              <li>• "Monthly materials for october"</li>
              <li>• "Cash flow breakdown"</li>
              <li>• "Business plan gp"</li>
              <li>• "Net profit"</li>
            </ul>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-slate-700">
          <p className="text-xs text-slate-500">
            Powered by Next.js + Vercel
          </p>
        </div>
      </aside>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 border-b border-slate-700 flex items-center px-6 bg-slate-800/50">
          <Bot className="w-6 h-6 text-blue-400 mr-3" />
          <h2 className="text-white font-semibold">Financial Assistant</h2>
          {selectedProject && (
            <span className="ml-4 px-3 py-1 bg-blue-500/20 text-blue-400 text-sm rounded-full">
              {selectedProject}
            </span>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.role === 'user' ? 'bg-blue-500' : 'bg-green-500'
                }`}>
                  {message.role === 'user' ? (
                    <User className="w-4 h-4 text-white" />
                  ) : (
                    <Bot className="w-4 h-4 text-white" />
                  )}
                </div>
                <div className={`rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-700 text-slate-100'
                }`}>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-700 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {!selectedProject && (
            <div className="flex justify-center">
              <div className="bg-slate-700/50 rounded-xl p-6 text-center">
                <Building2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400">Select a project from the sidebar to start querying data</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/50">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedProject ? "Ask about financial data..." : "Select a project first"}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              disabled={isLoading || !selectedProject}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim() || !selectedProject}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 flex items-center justify-center transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
