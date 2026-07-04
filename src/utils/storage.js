import { getDiscoveryForVisit } from './discoveries.js'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const CACHE_KEY = 'stagepass.lastPhoneNumber';
const MEMBERS_KEY = 'stagepass.members';
const VISITS_KEY = 'stagepass.visits';

const MILESTONES = [
  { count: 5, label: 'Supporter' },
  { count: 10, label: 'Patron' },
  { count: 20, label: 'Founding Member' },
];

function getTodaySAST() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const sastOffset = -120;
  const local = new Date(now.getTime() + (sastOffset - offset) * 60000);
  return local.toISOString().slice(0, 10);
}

function nextMilestone(totalVisits) {
  for (const m of MILESTONES) {
    if (totalVisits < m.count) return m;
  }
  return { count: totalVisits, label: 'Founding Member' };
}

function getLocalMembers() {
  try {
    return JSON.parse(localStorage.getItem(MEMBERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalMembers(members) {
  try {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
  } catch {}
}

function getLocalVisits() {
  try {
    return JSON.parse(localStorage.getItem(VISITS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalVisits(visits) {
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(visits));
  } catch {}
}

function localLookupMember(phoneNumber) {
  if (!phoneNumber) return null;
  const members = getLocalMembers();
  const member = members.find(m => m.phoneNumber === phoneNumber);
  if (!member) return null;
  return {
    exists: true,
    firstName: member.firstName,
    totalVisits: member.totalVisits,
    discoveries: member.discoveries || [],
  };
}

function localRecordVisit({ firstName, phoneNumber }) {
  if (!phoneNumber) throw new Error('phoneNumber is required');

  const members = getLocalMembers();
  const visits = getLocalVisits();
  const today = getTodaySAST();
  const now = new Date().toISOString();
  const existing = members.find(m => m.phoneNumber === phoneNumber);

  if (existing) {
    if (existing.lastVisitDate === today) {
      const milestone = nextMilestone(existing.totalVisits);
      return {
        firstName: existing.firstName,
        totalVisits: existing.totalVisits,
        isReturning: true,
        alreadyCheckedInToday: true,
        milestone,
        newDiscovery: null,
      };
    }
    const totalVisits = existing.totalVisits + 1;
    existing.totalVisits = totalVisits;
    existing.lastVisitAt = now;
    existing.lastVisitDate = today;

    if (!existing.discoveries) existing.discoveries = [];
    const discovery = getDiscoveryForVisit(totalVisits);
    if (discovery && !existing.discoveries.includes(discovery.id)) {
      existing.discoveries.push(discovery.id);
    }

    saveLocalMembers(members);

    visits.push({
      visitId: crypto.randomUUID(),
      memberId: phoneNumber,
      timestamp: now,
    });
    saveLocalVisits(visits);

    const milestone = nextMilestone(totalVisits);
    return {
      firstName: existing.firstName,
      totalVisits,
      isReturning: true,
      alreadyCheckedInToday: false,
      milestone,
      newDiscovery: discovery,
    };
  }

  const resolvedFirstName = firstName || 'Friend';
  const newMember = {
    phoneNumber,
    firstName: resolvedFirstName,
    totalVisits: 1,
    createdAt: now,
    lastVisitAt: now,
    lastVisitDate: today,
    discoveries: [],
  };

  const discovery = getDiscoveryForVisit(1);
  if (discovery) newMember.discoveries.push(discovery.id);

  members.push(newMember);
  saveLocalMembers(members);

  visits.push({
    visitId: crypto.randomUUID(),
    memberId: phoneNumber,
    timestamp: now,
  });
  saveLocalVisits(visits);

  const milestone = nextMilestone(1);
  return {
    firstName: resolvedFirstName,
    totalVisits: 1,
    isReturning: false,
    alreadyCheckedInToday: false,
    milestone,
    newDiscovery: discovery,
  };
}

export function getCachedPhoneNumber() {
  try {
    return localStorage.getItem(CACHE_KEY) || '';
  } catch {
    return '';
  }
}

export function setCachedPhoneNumber(phoneNumber) {
  try {
    localStorage.setItem(CACHE_KEY, phoneNumber);
  } catch {}
}

export async function lookupMember(phoneNumber) {
  if (!phoneNumber) return null;

  if (API_BASE) {
    try {
      const res = await fetch(
        `${API_BASE}/members?phoneNumber=${encodeURIComponent(phoneNumber)}`
      );
      if (res.ok) {
        const data = await res.json();
        return data.exists ? data : null;
      }
    } catch {}
  }

  return localLookupMember(phoneNumber);
}

export async function recordVisit({ firstName, phoneNumber }) {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, phoneNumber }),
      });
      if (res.ok) return res.json();
    } catch {}
  }

  return localRecordVisit({ firstName, phoneNumber });
}

export function getMembers() {
  return getLocalMembers();
}

export function getVisits() {
  return getLocalVisits();
}

export function getMemberByPhone(phoneNumber) {
  return getLocalMembers().find(m => m.phoneNumber === phoneNumber) || null;
}
