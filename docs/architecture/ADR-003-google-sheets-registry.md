# Architecture Decision Record: Google Sheets Registry

## Status
Accepted (Initial Phase)

## Context
KWD currently uses various Google Sheets to track documents (Memorandum Tracker, Board Resolution Tracker, etc.). We need a database to store document metadata so the application can search and filter it quickly.

## Decision
Initially, Google Sheets will be retained as the backend registry. The application will interface with Google Sheets via API to read and write document metadata. A unified registry approach is recommended over multiple fragmented sheets.

## Consequences
- **Positive:** Familiar to the KWD staff. Acts as a soft transition—if the application goes down, staff can still view the raw Sheets. No need to migrate existing tracker data to a SQL database immediately.
- **Negative:** Google Sheets API is slower and less robust for complex queries than a native SQL database.
- **Future:** If performance or complexity demands it, the registry can be migrated to Supabase PostgreSQL in a later phase.
