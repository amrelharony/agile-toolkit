"use client";

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/** True when the user has Data Saver mode on, or the connection is very slow. */
export function isSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!conn) return false;
  if (conn.saveData === true) return true;
  // Treat 2g as equivalent to save-data for particle budget purposes
  if (conn.effectiveType && /2g/.test(conn.effectiveType)) return true;
  return false;
}
