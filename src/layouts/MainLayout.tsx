import { Outlet, Link, useLocation } from 'react-router-dom'
import { Settings, MessageSquare, Terminal, Sun, Moon, Monitor, Bot, GitCompare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/contexts/ThemeContext'

const topNavItems = [
  { path: '/chat', label: 'AGENT', icon: Bot },
  { path: '/compare', label: '对比', icon: GitCompare },
  { path: '/', label: '设置', icon: Settings },
]

export default function MainLayout() {
  const location = useLocation()
  const { theme, setTheme } = useTheme()

  const cycleTheme = () => {
    const themes: Array<'system' | 'dark' | 'light'> = ['system', 'dark', 'light']
    const currentIndex = themes.indexOf(theme as 'system' | 'dark' | 'light')
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex] ?? 'system')
  }

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center px-4 shrink-0">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 mr-8">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-primary" />
          </div>
          <span className="font-bold text-lg">{import.meta.env.VITE_APP_TITLE || 'ClawDeck'}</span>
        </Link>

        {/* Top Navigation Items */}
        <nav className="flex items-center gap-1">
          {topNavItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right Side Actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycleTheme}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title={theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}
          >
            <ThemeIcon className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden bg-background">
        <Outlet />
      </main>
    </div>
  )
}
