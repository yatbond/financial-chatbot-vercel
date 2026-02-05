'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, Bot, User, FileSpreadsheet, TrendingUp, ChevronDown, Loader2, Calendar, Building2 } from 'lucide-react'

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
      content: "👋 Hi! I'm your financial assistant.\n\nSelect a project and ask questions:\n• 'What is the gross profit?'\n• 'Show projected gp'\n• 'Monthly materials'\n• 'Cash flow breakdown'"
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
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
  const [showFilters, setShowFilters] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadStructure()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
          content: `❌ **Error:** ${data.error}`
        }])
      }
      
      setFolders(data.folders)
      setProjects(data.projects)

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
          content: '⚠️ No data found. Check folder sharing.'
        }])
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ **Connection Error:** ${error}`
      }])
    } finally {
      setIsLoading(false)
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
      setShowFilters(false)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **${selectedProject}**\n\n📊 Key Metrics ('000):\n• BP GP: $${data.metrics['Business Plan GP'].toLocaleString()}\n• Proj GP: $${data.metrics['Projected GP'].toLocaleString()}\n• WIP GP: $${data.metrics['WIP GP'].toLocaleString()}\n• Cash Flow: $${data.metrics['Cash Flow'].toLocaleString()}`
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
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Error. Try again.' }])
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

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Connecting to Google Drive...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-blue-400" />
            <h1 className="text-lg font-bold text-white">Financial Bot</h1>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="p-2 bg-slate-700 rounded-lg text-slate-300"
          >
            <Calendar className="w-5 h-5" />
          </button>
        </div>

        {/* Collapsible Filters */}
        {showFilters && (
          <div className="mt-4 space-y-3">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
            >
              {Object.keys(folders).sort().reverse().map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
            >
              {folders[selectedYear]?.sort((a, b) => parseInt(b) - parseInt(a)).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              value={selectedProject}
              onChange={handleProjectSelect}
              disabled={isLoadingProject}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
            >
              <option value="">-- Select Project --</option>
              {availableProjects
                .sort((a, b) => parseInt(a.code) - parseInt(b.code))
                .map(p => (
                  <option key={p.filename} value={`${p.code} - ${p.name}`}>
                    {p.code} {p.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Selected Project Badge */}
        {selectedProject && (
          <div className="mt-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-green-400" />
            <span className="text-green-400 text-sm font-medium">{selectedProject}</span>
          </div>
        )}

        {/* Quick Metrics */}
        {metrics && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700/50 rounded px-2 py-1">
              <span className="text-slate-400">BP GP: </span>
              <span className="text-green-400">${metrics['Business Plan GP'].toLocaleString()}</span>
            </div>
            <div className="bg-slate-700/50 rounded px-2 py-1">
              <span className="text-slate-400">Proj GP: </span>
              <span className="text-blue-400">${metrics['Projected GP'].toLocaleString()}</span>
            </div>
            <div className="bg-slate-700/50 rounded px-2 py-1">
              <span className="text-slate-400">WIP: </span>
              <span className="text-purple-400">${metrics['WIP GP'].toLocaleString()}</span>
            </div>
            <div className="bg-slate-700/50 rounded px-2 py-1">
              <span className="text-slate-400">CF: </span>
              <span className="text-yellow-400">${metrics['Cash Flow'].toLocaleString()}</span>
            </div>
          </div>
        )}
      </header>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, i) => (
          <div key={i} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex gap-2 max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === 'user' ? 'bg-blue-500' : 'bg-green-500'
              }`}>
                {message.role === 'user' ? (
                  <User className="w-4 h-4 text-white" />
                ) : (
                  <Bot className="w-4 h-4 text-white" />
                )}
              </div>
              <div className={`rounded-xl px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-700 text-slate-100'
              }`}>
                <div className="whitespace-pre-wrap text-sm">{message.content}</div>
              </div>
            </div>
          </div>
        ))}

        {!selectedProject && (
          <div className="text-center py-8">
            <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">Tap 📅 to select a project</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-700 bg-slate-800/50">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedProject ? "Ask about financial data..." : "Select a project first"}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-2 text-white placeholder-slate-500 text-sm"
            disabled={!selectedProject}
          />
          <button
            type="submit"
            disabled={!input.trim() || !selectedProject}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </main>
  )
}
