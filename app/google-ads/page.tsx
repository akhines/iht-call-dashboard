"use client";

import { useState } from "react";

export default function GoogleAdsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      {/* ─── SIDEBAR ─── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 flex-shrink-0 flex flex-col transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#1a1f36" }}
      >
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1>
              <p className="text-blue-300 text-xs">Google Ads</p>
            </div>
            <button className="ml-auto lg:hidden text-gray-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {/* Ops Scorecard parent */}
          <a href="/scorecard" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Ops Scorecard
          </a>
          <a href="/call-dashboard" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Calls
          </a>

          {/* Marketing parent */}
          <a href="/marketing" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 mt-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
            Marketing
          </a>
          <a href="/direct-mail" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 0v10a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9-5 9 5" />
            </svg>
            Direct Mail
          </a>
          <button className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm bg-white/10 text-white border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Google Ads
          </button>
          <a href="/seo" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            SEO
          </a>
          <a href="/tv" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="5" width="18" height="13" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 18v3" />
            </svg>
            TV
          </a>
        </nav>
        <div className="p-4 border-t border-white/10">
          <p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p>
        </div>
      </aside>

      {/* ─── MAIN ─── */}
      <main className="flex-1 overflow-auto bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100" onClick={() => setSidebarOpen(true)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Google Ads Performance</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Source: <span className="font-medium text-gray-700">Looker Studio</span>
                <span className="ml-2 text-gray-400">&middot; Google Ads Live</span>
              </p>
            </div>
          </div>
        </header>
        <div className="flex-1 bg-white">
          <iframe
            src="https://datastudio.google.com/embed/reporting/f5bcb1ae-3514-4f30-b7e8-11d32fdfdddf/page/FumBB"
            width="100%"
            height="1200"
            frameBorder="0"
            style={{ border: 0, width: "100%", minHeight: "calc(100vh - 73px)" }}
            allowFullScreen
            sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </main>
    </div>
  );
}
