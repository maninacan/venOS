import React, { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import {
  PieChart,
  Pie,
  Cell,
  Label,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import { scaleLinear } from 'd3-scale';
import { ISO_COUNTRIES, countryNameFromA2 } from '../../lib/isoCountries';

const GET_DASHBOARD = gql`
  query GetAdminDashboard {
    adminDashboard {
      totalUsers totalCompanies totalEvents totalFinalizedEvents
      newUsers30d newCompanies30d newEvents30d newFinalizedEvents30d
      proCount starterCount
      activatedCompanies activationRate
      squareConnectedCount squareConnectedRate
      avgEventsPerCompany avgNetProfitPerEvent
      companiesInactive60d starterAtLimit
      companiesByMonth { month count }
      eventsByMonth { month count }
      topZipCodes { zipCode count }
      eventsByState { state count }
      eventsByCountry { country count }
    }
  }
`;

interface Dashboard {
  totalUsers: number; totalCompanies: number; totalEvents: number; totalFinalizedEvents: number;
  newUsers30d: number; newCompanies30d: number; newEvents30d: number; newFinalizedEvents30d: number;
  proCount: number; starterCount: number;
  activatedCompanies: number; activationRate: number;
  squareConnectedCount: number; squareConnectedRate: number;
  avgEventsPerCompany: number; avgNetProfitPerEvent: number | null;
  companiesInactive60d: number; starterAtLimit: number;
  companiesByMonth: { month: string; count: number }[];
  eventsByMonth: { month: string; count: number }[];
  topZipCodes: { zipCode: string; count: number }[];
  eventsByState: { state: string; count: number }[];
  eventsByCountry: { country: string; count: number }[];
}

function pct(rate: number) { return `${(rate * 100).toFixed(1)}%`; }

function fmtMonth(m: string) {
  const [year, month] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(month, 10) - 1]} '${year.slice(2)}`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, delta, deltaLabel, sub }: {
  label: string; value: string | number;
  delta?: number | null; deltaLabel?: string; sub?: string;
}) {
  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 flex flex-col gap-1 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">{label}</div>
      <div className="text-[2rem] font-bold text-[#0B2A4A] leading-none mt-1">{value}</div>
      {delta != null && (
        <div className={`text-[0.75rem] font-medium ${delta > 0 ? 'text-[#166534]' : 'text-[#64748b]'}`}>
          {delta > 0 ? `+${delta}` : delta} {deltaLabel ?? 'last 30d'}
        </div>
      )}
      {sub && <div className="text-[0.75rem] text-[#64748b] mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Rate card with inline bar ─────────────────────────────────────────────────
function RateCard({ label, count, total, rate, sub }: {
  label: string; count: number; total: number; rate: number; sub?: string;
}) {
  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-2">{label}</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[2rem] font-bold text-[#0B2A4A] leading-none">{count}</span>
        <span className="text-[0.82rem] text-[#64748b]">/ {total} ({pct(rate)})</span>
      </div>
      <div className="h-1.5 bg-[#e2e8f0] rounded-full overflow-hidden">
        <div className="h-full bg-[#0B2A4A] rounded-full transition-all duration-500"
          style={{ width: `${Math.min(rate * 100, 100)}%` }} />
      </div>
      {sub && <div className="text-[0.72rem] text-[#64748b] mt-2">{sub}</div>}
    </div>
  );
}

// ── Health alert card ─────────────────────────────────────────────────────────
function AlertCard({ label, value, description, severity }: {
  label: string; value: number; description: string; severity: 'amber' | 'red';
}) {
  const c = severity === 'red'
    ? { bg: 'bg-[#fef2f2]', border: 'border-[#fecaca]', val: 'text-[#991b1b]', dot: 'bg-[#dc2626]' }
    : { bg: 'bg-[#fffbeb]', border: 'border-[#fde68a]', val: 'text-[#92400e]', dot: 'bg-[#f59e0b]' };
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.04)]`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
        <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">{label}</div>
      </div>
      <div className={`text-[2rem] font-bold leading-none mb-1 ${c.val}`}>{value}</div>
      <div className="text-[0.75rem] text-[#64748b]">{description}</div>
    </div>
  );
}

// ── Plan distribution donut chart ─────────────────────────────────────────────
function PlanDonutCard({ proCount, starterCount }: { proCount: number; starterCount: number }) {
  const total = proCount + starterCount;
  const proRate = total > 0 ? proCount / total : 0;
  const data = [
    { name: 'Pro', value: proCount, color: '#fbbf24' },
    { name: 'Starter', value: Math.max(starterCount, total === 0 ? 1 : 0), color: '#0B2A4A' },
  ];
  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-1">Plan Distribution</div>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={33} outerRadius={50}
              dataKey="value"
              strokeWidth={2} stroke="#fff"
              startAngle={90} endAngle={-270}
            >
              <Label
                value={pct(proRate)}
                position="center"
                style={{ fontSize: '0.85rem', fontWeight: 700, fill: '#0B2A4A' }}
              />
              {data.map(entry => <Cell key={entry.name} fill={entry.color} />)}
            </Pie>
            <Tooltip
              formatter={(v: number, n: string) => [v, n]}
              contentStyle={{ fontSize: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: '#fbbf24' }} />
              <span className="text-[0.72rem] font-semibold text-[#92400e] uppercase tracking-wider">Pro</span>
            </div>
            <div className="text-[1.5rem] font-bold text-[#92400e] leading-none">{proCount}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-[#0B2A4A]" />
              <span className="text-[0.72rem] font-semibold text-[#64748b] uppercase tracking-wider">Starter</span>
            </div>
            <div className="text-[1.5rem] font-bold text-[#0B2A4A] leading-none">{starterCount}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Finalization rate donut ───────────────────────────────────────────────────
function FinalizationDonut({ finalized, total }: { finalized: number; total: number }) {
  const rate = total > 0 ? finalized / total : 0;
  const remaining = Math.max(total - finalized, 0);
  const data = [
    { name: 'Finalized', value: finalized, color: '#166534' },
    { name: 'Not yet', value: Math.max(remaining, total === 0 ? 1 : 0), color: '#e2e8f0' },
  ];
  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-1">Finalization Rate</div>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={110} height={110}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={33} outerRadius={50}
              dataKey="value"
              strokeWidth={2} stroke="#fff"
              startAngle={90} endAngle={-270}
            >
              <Label
                value={pct(rate)}
                position="center"
                style={{ fontSize: '0.85rem', fontWeight: 700, fill: '#0B2A4A' }}
              />
              {data.map(entry => <Cell key={entry.name} fill={entry.color} />)}
            </Pie>
            <Tooltip
              formatter={(v: number, n: string) => [v, n]}
              contentStyle={{ fontSize: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-[#166534]" />
              <span className="text-[0.72rem] font-semibold text-[#166534] uppercase tracking-wider">Finalized</span>
            </div>
            <div className="text-[1.5rem] font-bold text-[#166534] leading-none">{finalized}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-[#e2e8f0]" />
              <span className="text-[0.72rem] font-semibold text-[#64748b] uppercase tracking-wider">Pending</span>
            </div>
            <div className="text-[1.5rem] font-bold text-[#64748b] leading-none">{remaining}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Activation pipeline funnel ────────────────────────────────────────────────
function PipelineCard({ totalCompanies, activatedCompanies, squareConnectedCount, proCount }: {
  totalCompanies: number; activatedCompanies: number;
  squareConnectedCount: number; proCount: number;
}) {
  const stages = [
    { label: 'Total Companies',  count: totalCompanies,       color: '#cbd5e1' },
    { label: 'Activated (≥1 event)', count: activatedCompanies,  color: '#93c5fd' },
    { label: 'Square Connected', count: squareConnectedCount,  color: '#19B37A' },
    { label: 'Pro Plan',         count: proCount,              color: '#fbbf24' },
  ];
  const max = totalCompanies || 1;
  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-4">Activation Pipeline</div>
      <div className="flex flex-col gap-3">
        {stages.map((s, i) => {
          const barPct = (s.count / max) * 100;
          const dropPct = i > 0 ? ((stages[i - 1].count - s.count) / max) * 100 : 0;
          return (
            <div key={s.label}>
              <div className="flex items-center justify-between text-[0.75rem] mb-1">
                <span className="font-medium text-[#0B2A4A]">{s.label}</span>
                <span className="text-[#64748b] tabular-nums">
                  {s.count}
                  {i > 0 && stages[i-1].count > 0 && (
                    <span className="ml-1 text-[#94a3b8]">({pct(s.count / stages[i-1].count)})</span>
                  )}
                </span>
              </div>
              <div className="relative h-6 bg-[#f1f5f9] rounded-md overflow-hidden">
                {/* Drop-off shading */}
                {i > 0 && dropPct > 0 && (
                  <div
                    className="absolute top-0 bottom-0 bg-[#f8fafc]"
                    style={{ left: `${barPct}%`, width: `${dropPct}%` }}
                  />
                )}
                {/* Bar */}
                <div
                  className="absolute top-0 left-0 h-full rounded-md flex items-center transition-all duration-500"
                  style={{ width: `${barPct}%`, background: s.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[0.7rem] text-[#94a3b8]">Bars show share of total companies · parentheses show stage-over-stage conversion</div>
    </div>
  );
}

// ── Combined area trend chart (companies + events overlaid) ───────────────────
function CombinedTrendChart({
  companiesByMonth,
  eventsByMonth,
}: {
  companiesByMonth: { month: string; count: number }[];
  eventsByMonth: { month: string; count: number }[];
}) {
  const data = companiesByMonth.map((c, i) => ({
    label: fmtMonth(c.month),
    companies: c.count,
    events: eventsByMonth[i]?.count ?? 0,
  }));
  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">New Companies &amp; Events — Last 6 Months</div>
        <div className="flex items-center gap-4 text-[0.72rem] text-[#64748b]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#0B2A4A] inline-block rounded" />Companies
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#19B37A] inline-block rounded" />Events
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="companyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#0B2A4A" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#0B2A4A" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="eventGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#19B37A" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#19B37A" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis hide allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: '0.75rem', border: '1px solid #e2e8f0', borderRadius: 8 }}
            labelStyle={{ fontWeight: 600 }}
          />
          <Area type="monotone" dataKey="companies" name="Companies" stroke="#0B2A4A" strokeWidth={2} fill="url(#companyGrad)" dot={{ r: 3, fill: '#0B2A4A' }} />
          <Area type="monotone" dataKey="events"    name="Events"    stroke="#19B37A" strokeWidth={2} fill="url(#eventGrad)"   dot={{ r: 3, fill: '#19B37A' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── State drill-down data + query ─────────────────────────────────────────────

const GET_COMPANIES_IN_STATE = gql`
  query CompaniesInState($state: String!) {
    companiesInState(state: $state) {
      id name plan lat lng city zipCode eventCount memberCount
    }
  }
`;

interface CompanyLocation {
  id: string; name: string; plan: string;
  lat: number; lng: number; city?: string; zipCode?: string;
  eventCount: number; memberCount: number;
}

// FIPS code for each state (used to filter county TopoJSON)
const STATE_FIPS: Record<string, string> = {
  AL:'01', AK:'02', AZ:'04', AR:'05', CA:'06', CO:'08', CT:'09', DE:'10',
  DC:'11', FL:'12', GA:'13', HI:'15', ID:'16', IL:'17', IN:'18', IA:'19',
  KS:'20', KY:'21', LA:'22', ME:'23', MD:'24', MA:'25', MI:'26', MN:'27',
  MS:'28', MO:'29', MT:'30', NE:'31', NV:'32', NH:'33', NJ:'34', NM:'35',
  NY:'36', NC:'37', ND:'38', OH:'39', OK:'40', OR:'41', PA:'42', RI:'44',
  SC:'45', SD:'46', TN:'47', TX:'48', UT:'49', VT:'50', VA:'51', WA:'53',
  WV:'54', WI:'55', WY:'56',
};

// geoMercator center [lon, lat] and scale for each state
const STATE_PROJECTIONS: Record<string, { center: [number, number]; scale: number }> = {
  AL:{ center:[-86.8, 32.8],  scale:4500  }, AK:{ center:[-154,  63.5],  scale:1200  },
  AZ:{ center:[-111.7,34.2],  scale:4200  }, AR:{ center:[-92.4, 34.8],  scale:5200  },
  CA:{ center:[-119.6,37.2],  scale:2800  }, CO:{ center:[-105.5,39.0],  scale:4800  },
  CT:{ center:[-72.7, 41.6],  scale:18000 }, DE:{ center:[-75.5, 39.1],  scale:22000 },
  FL:{ center:[-81.6, 28.1],  scale:3800  }, GA:{ center:[-83.4, 32.7],  scale:4200  },
  HI:{ center:[-157.5,20.3],  scale:6000  }, ID:{ center:[-114.6,44.4],  scale:3200  },
  IL:{ center:[-89.2, 40.1],  scale:4500  }, IN:{ center:[-86.3, 40.0],  scale:5800  },
  IA:{ center:[-93.1, 41.9],  scale:5000  }, KS:{ center:[-98.4, 38.5],  scale:4800  },
  KY:{ center:[-84.9, 37.8],  scale:5500  }, LA:{ center:[-91.8, 31.1],  scale:5000  },
  ME:{ center:[-69.2, 45.4],  scale:4800  }, MD:{ center:[-76.8, 39.0],  scale:10000 },
  MA:{ center:[-71.8, 42.3],  scale:12000 }, MI:{ center:[-85.5, 44.3],  scale:3500  },
  MN:{ center:[-93.9, 46.3],  scale:3500  }, MS:{ center:[-89.7, 32.7],  scale:4800  },
  MO:{ center:[-92.5, 38.5],  scale:4500  }, MT:{ center:[-109.6,47.1],  scale:3000  },
  NE:{ center:[-99.9, 41.7],  scale:4500  }, NV:{ center:[-116.8,39.5],  scale:3500  },
  NH:{ center:[-71.6, 43.7],  scale:9500  }, NJ:{ center:[-74.5, 40.1],  scale:12000 },
  NM:{ center:[-106.1,34.4],  scale:3800  }, NY:{ center:[-75.3, 42.9],  scale:4000  },
  NC:{ center:[-79.4, 35.5],  scale:5000  }, ND:{ center:[-100.5,47.5],  scale:4800  },
  OH:{ center:[-82.8, 40.4],  scale:5500  }, OK:{ center:[-97.5, 35.5],  scale:4800  },
  OR:{ center:[-120.5,43.9],  scale:3800  }, PA:{ center:[-77.2, 41.1],  scale:5500  },
  RI:{ center:[-71.5, 41.7],  scale:35000 }, SC:{ center:[-81.0, 33.8],  scale:6000  },
  SD:{ center:[-100.2,44.5],  scale:4800  }, TN:{ center:[-86.7, 35.8],  scale:5800  },
  TX:{ center:[-99.3, 31.5],  scale:2500  }, UT:{ center:[-111.5,39.4],  scale:4000  },
  VT:{ center:[-72.7, 44.1],  scale:9500  }, VA:{ center:[-79.5, 37.5],  scale:5500  },
  WA:{ center:[-120.7,47.5],  scale:4200  }, WV:{ center:[-80.6, 38.9],  scale:6000  },
  WI:{ center:[-89.8, 44.5],  scale:4500  }, WY:{ center:[-107.6,43.0],  scale:4500  },
  DC:{ center:[-77.0, 38.9],  scale:100000},
};

const US_COUNTIES_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';

const STATE_NAME_TO_CODE: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

const STATE_CODE_TO_NAME = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name])
);

function StateDrillDown({ state, onBack }: { state: string; onBack: () => void }) {
  const [tooltip, setTooltip] = useState<{
    name: string; plan: string; city?: string;
    eventCount: number; memberCount: number;
    x: number; y: number;
  } | null>(null);

  const { data, loading } = useQuery<{ companiesInState: CompanyLocation[] }>(
    GET_COMPANIES_IN_STATE,
    { variables: { state } }
  );

  const companies = data?.companiesInState ?? [];
  const fips = STATE_FIPS[state];
  const proj = STATE_PROJECTIONS[state] ?? { center: [-98.5, 39.5] as [number, number], scale: 900 };
  const stateName = STATE_CODE_TO_NAME[state] ?? state;

  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl shadow-[0_2px_8px_rgba(11,42,74,0.06)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(11,42,74,0.08)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[0.78rem] font-medium text-[#64748b] hover:text-[#0B2A4A] transition-colors bg-transparent border-0 cursor-pointer p-0 font-[inherit]"
          >
            ← Back to US
          </button>
          <span className="text-[#dde3f0]">|</span>
          <div>
            <span className="text-[0.95rem] font-bold text-[#0B2A4A]">{stateName}</span>
            <span className="ml-2 text-[0.75rem] text-[#64748b]">
              {loading ? 'Loading…' : `${companies.length} compan${companies.length !== 1 ? 'ies' : 'y'}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[0.72rem] text-[#94a3b8]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#fbbf24] inline-block" />Pro
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0B2A4A] inline-block" />Starter
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="relative">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ center: proj.center, scale: proj.scale }}
          style={{ width: '100%', height: 'auto' }}
        >
          {/* County fills */}
          <Geographies geography={US_COUNTIES_URL}>
            {({ geographies }) =>
              geographies
                .filter(geo => fips && (geo.id as string).startsWith(fips))
                .map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    style={{
                      default: { fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 0.5, outline: 'none' },
                      hover:   { fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 0.5, outline: 'none' },
                      pressed: { fill: '#f1f5f9', stroke: '#cbd5e1', strokeWidth: 0.5, outline: 'none' },
                    }}
                  />
                ))
            }
          </Geographies>

          {/* Company markers */}
          {companies.map(company => (
            <Marker
              key={company.id}
              coordinates={[company.lng, company.lat]}
            >
              <circle
                r={Math.max(4, Math.min(10, 4 + company.eventCount * 0.5))}
                fill={company.plan === 'pro' ? '#fbbf24' : '#0B2A4A'}
                stroke="#fff"
                strokeWidth={1.5}
                style={{ cursor: 'pointer', transition: 'r 0.15s' }}
                onMouseEnter={(evt: React.MouseEvent) => setTooltip({
                  name: company.name,
                  plan: company.plan,
                  city: company.city,
                  eventCount: company.eventCount,
                  memberCount: company.memberCount,
                  x: evt.clientX,
                  y: evt.clientY,
                })}
                onMouseLeave={() => setTooltip(null)}
              />
            </Marker>
          ))}
        </ComposableMap>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 bg-[#0B2A4A] text-white text-[0.75rem] px-3 py-2 rounded-lg shadow-lg pointer-events-none min-w-[160px]"
            style={{ left: tooltip.x + 12, top: tooltip.y - 48 }}
          >
            <div className="font-semibold mb-0.5">{tooltip.name}</div>
            {tooltip.city && <div className="text-white/70 text-[0.7rem] mb-1">{tooltip.city}</div>}
            <div className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${tooltip.plan === 'pro' ? 'bg-[#fbbf24]' : 'bg-white/50'}`} />
              <span className="capitalize">{tooltip.plan}</span>
            </div>
            <div className="text-white/70 text-[0.7rem] mt-1">
              {tooltip.eventCount} event{tooltip.eventCount !== 1 ? 's' : ''} · {tooltip.memberCount} member{tooltip.memberCount !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <span className="spinner spinner-dark" style={{ width: 22, height: 22, borderWidth: 2 }} />
          </div>
        )}
      </div>

      {/* Company list */}
      {!loading && companies.length > 0 && (
        <div className="border-t border-[rgba(11,42,74,0.08)]">
          <div className="px-5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">
            Companies in {stateName}
          </div>
          <div className="divide-y divide-[rgba(11,42,74,0.06)] max-h-48 overflow-y-auto">
            {companies.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.plan === 'pro' ? 'bg-[#fbbf24]' : 'bg-[#0B2A4A]'}`} />
                <span className="text-[0.84rem] font-medium text-[#0B2A4A] flex-1 truncate">{c.name}</span>
                {c.city && <span className="text-[0.75rem] text-[#94a3b8] shrink-0">{c.city}</span>}
                <span className="text-[0.75rem] text-[#64748b] shrink-0 tabular-nums">
                  {c.eventCount} event{c.eventCount !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && companies.length === 0 && (
        <div className="px-5 py-8 text-center text-[0.84rem] text-[#94a3b8]">
          No companies with event history found in {stateName}.
        </div>
      )}
    </div>
  );
}

// ── US state choropleth ───────────────────────────────────────────────────────
const US_TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

function USMap({ eventsByState, onStateClick }: {
  eventsByState: { state: string; count: number }[];
  onStateClick: (state: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ state: string; count: number; x: number; y: number } | null>(null);

  const stateMap = new Map(eventsByState.map(s => [s.state, s.count]));
  const maxCount = Math.max(...eventsByState.map(s => s.count), 1);

  const colorScale = scaleLinear<string>()
    .domain([0, maxCount])
    .range(['#dbeafe', '#0B2A4A'])
    .clamp(true);

  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">Event Activity by State</div>
          <div className="text-[0.72rem] text-[#94a3b8] mt-0.5">Derived from event zip codes</div>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-1.5 text-[0.65rem] text-[#94a3b8]">
          <span>0</span>
          <div className="h-2 w-24 rounded-sm" style={{
            background: 'linear-gradient(to right, #dbeafe, #0B2A4A)',
          }} />
          <span>{maxCount}</span>
        </div>
      </div>

      <div className="relative" style={{ width: '100%' }}>
        <ComposableMap
          projection="geoAlbersUsa"
          projectionConfig={{ scale: 900 }}
          style={{ width: '100%', height: 'auto' }}
        >
          <Geographies geography={US_TOPO_URL}>
            {({ geographies }) =>
              geographies.map(geo => {
                const stateName = geo.properties['name'] as string;
                const code = STATE_NAME_TO_CODE[stateName];
                const count = code ? (stateMap.get(code) ?? 0) : 0;
                const fill = count > 0 ? colorScale(count) : '#f1f5f9';
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onClick={() => code && onStateClick(code)}
                    onMouseEnter={(evt: React.MouseEvent) => {
                      if (code) setTooltip({ state: stateName, count, x: evt.clientX, y: evt.clientY });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      default: { fill, stroke: '#fff', strokeWidth: 0.5, outline: 'none', cursor: 'pointer' },
                      hover:   { fill: count > 0 ? '#19B37A' : '#e2e8f0', stroke: '#fff', strokeWidth: 0.5, outline: 'none', cursor: 'pointer' },
                      pressed: { fill: count > 0 ? '#166534' : '#cbd5e1', stroke: '#fff', strokeWidth: 0.5, outline: 'none' },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 bg-[#0B2A4A] text-white text-[0.75rem] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 36 }}
          >
            <span className="font-semibold">{tooltip.state}</span>
            {' — '}
            <span>{tooltip.count} event{tooltip.count !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Top 5 states summary */}
      {eventsByState.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {eventsByState.slice(0, 5).map(s => (
            <div key={s.state} className="flex items-center gap-1.5 bg-[#f8fafc] rounded-full px-3 py-1 text-[0.72rem]">
              <span className="font-bold text-[#0B2A4A]">{s.state}</span>
              <span className="text-[#64748b]">{s.count}</span>
            </div>
          ))}
          {eventsByState.length > 5 && (
            <div className="flex items-center text-[0.72rem] text-[#94a3b8] px-2">
              +{eventsByState.length - 5} more states
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── World map (event activity by country) ─────────────────────────────────────
const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

function WorldMap({ eventsByCountry }: { eventsByCountry: { country: string; count: number }[] }) {
  const [tooltip, setTooltip] = useState<{ name: string; count: number; x: number; y: number } | null>(null);

  // Aggregate counts by ISO numeric code (matches world-atlas geo.id, compared numerically).
  const countByNum = new Map<number, number>();
  for (const c of eventsByCountry) {
    const iso = ISO_COUNTRIES[c.country];
    if (iso) countByNum.set(parseInt(iso.num, 10), (countByNum.get(parseInt(iso.num, 10)) ?? 0) + c.count);
  }
  const maxCount = Math.max(...eventsByCountry.map(c => c.count), 1);
  const colorScale = scaleLinear<string>().domain([0, maxCount]).range(['#dbeafe', '#0B2A4A']).clamp(true);

  return (
    <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl p-5 shadow-[0_2px_8px_rgba(11,42,74,0.06)]">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">Event Activity by Country</div>
          <div className="text-[0.72rem] text-[#94a3b8] mt-0.5">Derived from each event's country</div>
        </div>
        <div className="flex items-center gap-1.5 text-[0.65rem] text-[#94a3b8]">
          <span>0</span>
          <div className="h-2 w-24 rounded-sm" style={{ background: 'linear-gradient(to right, #dbeafe, #0B2A4A)' }} />
          <span>{maxCount}</span>
        </div>
      </div>

      <div className="relative" style={{ width: '100%' }}>
        <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 150 }} style={{ width: '100%', height: 'auto' }}>
          <Geographies geography={WORLD_TOPO_URL}>
            {({ geographies }) =>
              geographies.map(geo => {
                const count = countByNum.get(parseInt(geo.id as string, 10)) ?? 0;
                const fill = count > 0 ? colorScale(count) : '#f1f5f9';
                const name = geo.properties['name'] as string;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onMouseEnter={(evt: React.MouseEvent) => setTooltip({ name, count, x: evt.clientX, y: evt.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      default: { fill, stroke: '#fff', strokeWidth: 0.4, outline: 'none' },
                      hover:   { fill: count > 0 ? '#19B37A' : '#e2e8f0', stroke: '#fff', strokeWidth: 0.4, outline: 'none' },
                      pressed: { fill: count > 0 ? '#166534' : '#cbd5e1', stroke: '#fff', strokeWidth: 0.4, outline: 'none' },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {tooltip && (
          <div
            className="fixed z-50 bg-[#0B2A4A] text-white text-[0.75rem] px-3 py-1.5 rounded-lg shadow-lg pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 36 }}
          >
            <span className="font-semibold">{tooltip.name}</span>
            {' — '}
            <span>{tooltip.count} event{tooltip.count !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Top 5 countries summary */}
      {eventsByCountry.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {eventsByCountry.slice(0, 5).map(c => (
            <div key={c.country} className="flex items-center gap-1.5 bg-[#f8fafc] rounded-full px-3 py-1 text-[0.72rem]">
              <span className="font-bold text-[#0B2A4A]">{countryNameFromA2(c.country)}</span>
              <span className="text-[#64748b]">{c.count}</span>
            </div>
          ))}
          {eventsByCountry.length > 5 && (
            <div className="flex items-center text-[0.72rem] text-[#94a3b8] px-2">
              +{eventsByCountry.length - 5} more countries
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-8 mb-3">
      <div className="h-px flex-1 bg-[rgba(11,42,74,0.08)]" />
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#64748b] whitespace-nowrap">{children}</span>
      <div className="h-px flex-1 bg-[rgba(11,42,74,0.08)]" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { data, loading } = useQuery<{ adminDashboard: Dashboard }>(GET_DASHBOARD);
  const d = data?.adminDashboard;
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [geoView, setGeoView] = useState<'us' | 'world'>('us');

  return (
    <>
      <div className="mb-6">
        <h1 className="mt-0 mb-1 text-[1.4rem] font-bold text-[#0B2A4A]">Dashboard</h1>
        <p className="m-0 text-[0.88rem] text-[#64748b]">Platform overview · all time unless noted</p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[0.88rem] text-[#64748b]">
          <span className="spinner spinner-dark" style={{ width: 16, height: 16, borderWidth: 2 }} />
          Loading…
        </div>
      )}

      {d && (
        <>
          {/* ── Growth ──────────────────────────────────────────────────────── */}
          <SectionHeader>Growth</SectionHeader>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Users"            value={d.totalUsers}           delta={d.newUsers30d}           />
            <StatCard label="Companies"        value={d.totalCompanies}       delta={d.newCompanies30d}       />
            <StatCard label="Events Created"   value={d.totalEvents}          delta={d.newEvents30d}          />
            <StatCard label="Events Finalized" value={d.totalFinalizedEvents} delta={d.newFinalizedEvents30d} />
          </div>

          {/* ── Plans & Activation ──────────────────────────────────────────── */}
          <SectionHeader>Plans &amp; Activation</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <PlanDonutCard proCount={d.proCount} starterCount={d.starterCount} />
            <RateCard
              label="Activated Companies"
              count={d.activatedCompanies}
              total={d.totalCompanies}
              rate={d.activationRate}
              sub="Have created at least 1 event"
            />
            <RateCard
              label="Square Connected"
              count={d.squareConnectedCount}
              total={d.totalCompanies}
              rate={d.squareConnectedRate}
              sub="POS integration enabled"
            />
          </div>

          {/* ── Activation Pipeline ─────────────────────────────────────────── */}
          <SectionHeader>Activation Pipeline</SectionHeader>
          <PipelineCard
            totalCompanies={d.totalCompanies}
            activatedCompanies={d.activatedCompanies}
            squareConnectedCount={d.squareConnectedCount}
            proCount={d.proCount}
          />

          {/* ── Engagement ──────────────────────────────────────────────────── */}
          <SectionHeader>Engagement</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FinalizationDonut
              finalized={d.totalFinalizedEvents}
              total={d.totalEvents}
            />
            <StatCard
              label="Avg Events / Company"
              value={d.avgEventsPerCompany.toFixed(1)}
              sub="Across all activated companies"
            />
            <StatCard
              label="Avg Net Profit / Event"
              value={d.avgNetProfitPerEvent != null ? `$${d.avgNetProfitPerEvent.toFixed(2)}` : '—'}
              sub={d.avgNetProfitPerEvent != null ? 'Across all events with profit data' : 'No profit data yet'}
            />
          </div>

          {/* ── Health Signals ──────────────────────────────────────────────── */}
          <SectionHeader>Health Signals</SectionHeader>
          <div className="grid grid-cols-2 gap-3">
            <AlertCard
              label="Inactive 60 Days"
              value={d.companiesInactive60d}
              description="Activated companies with no event in the last 60 days — potential churn"
              severity="amber"
            />
            <AlertCard
              label="Starter at Limit"
              value={d.starterAtLimit}
              description="Starter companies that have already finalized 1 event — upgrade candidates"
              severity="red"
            />
          </div>

          {/* ── Trends ──────────────────────────────────────────────────────── */}
          <SectionHeader>Trends</SectionHeader>
          <CombinedTrendChart
            companiesByMonth={d.companiesByMonth}
            eventsByMonth={d.eventsByMonth}
          />

          {/* ── Geography ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <SectionHeader>Geography</SectionHeader>
            <div className="inline-flex rounded-lg border border-[#e2e8f0] overflow-hidden text-[0.75rem] font-semibold">
              {(['us', 'world'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setGeoView(v)}
                  className={`px-3 py-1.5 ${geoView === v ? 'bg-[#0B2A4A] text-white' : 'bg-white text-[#64748b] hover:bg-[#f1f5f9]'}`}
                >
                  {v === 'us' ? 'United States' : 'World'}
                </button>
              ))}
            </div>
          </div>
          {geoView === 'world' ? (
            <WorldMap eventsByCountry={d.eventsByCountry} />
          ) : selectedState ? (
            <StateDrillDown state={selectedState} onBack={() => setSelectedState(null)} />
          ) : (
            <USMap eventsByState={d.eventsByState} onStateClick={setSelectedState} />
          )}

          {d.topZipCodes.length > 0 && (
            <div>
              <div className="mt-4 text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[#64748b] mb-2">Top Zip Codes</div>
              <div className="bg-white border border-[rgba(11,42,74,0.12)] rounded-xl shadow-[0_2px_8px_rgba(11,42,74,0.06)] overflow-hidden">
                <table className="w-full text-[0.84rem]">
                  <thead>
                    <tr className="border-b border-[rgba(11,42,74,0.08)]">
                      <th className="text-left px-5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">Zip Code</th>
                      <th className="text-left px-5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.06em] text-[#64748b]">Events</th>
                      <th className="px-5 py-3 w-1/2" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.topZipCodes.map((z, i) => {
                      const max = d.topZipCodes[0]?.count ?? 1;
                      return (
                        <tr key={z.zipCode} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}>
                          <td className="px-5 py-2.5 font-semibold text-[#0B2A4A]">{z.zipCode}</td>
                          <td className="px-5 py-2.5 text-[#64748b]">{z.count}</td>
                          <td className="px-5 py-2.5">
                            <div className="h-1.5 bg-[#e2e8f0] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#19B37A] rounded-full"
                                style={{ width: `${(z.count / max) * 100}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
