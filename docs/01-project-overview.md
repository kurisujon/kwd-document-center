# Project Overview

## 1. Context and Current State
Kiblawan Water District (KWD) currently manages digital documents using Google Drive, Google Sheets, and manually maintained document trackers (e.g., Memorandum, Board Resolution, Annual Report, and BAC-related trackers). Physical documents are organized via existing cabinets and procedures; **this application is NOT intended to replace the physical filing system.**

The major problem is the digital workflow. The current manual process involves uploading to Drive, copying the link, finding the correct Sheet, and pasting metadata. This makes both storing and retrieving documents slower and more error-prone than necessary.

## 2. Product Vision
The KWD Document Center must be:
- Simple, fast, and reliable
- Professional and organized
- Easy for non-technical office staff to use
- Inexpensive to operate and easy to maintain
- Searchable and secure

### Design Philosophy
The application should feel like a focused, professional software product. 
It should **NOT** feel like:
- An enterprise DMS or complicated government ERP
- A generic AI-generated dashboard or CRM
- An analytics platform

**The primary purpose is:** Find, manage, and access KWD documents quickly.

## 3. Target Workflow
The goal is to introduce a thin application layer that simplifies the process into a unified flow:
1. Upload Document
2. Enter Metadata
3. Save
4. *Application stores file in Google Drive automatically*
5. *Application records metadata in the document registry automatically*
6. Staff can immediately search, filter, open, or download the document

## 4. Non-Goals [CONFIRMED]
The initial system will **NOT** attempt to become:
- A replacement for physical filing
- A complete enterprise document management system (DMS)
- An OCR platform or AI document analysis system
- An automated legal review or full records-management platform
- An enterprise search engine (e.g., Elasticsearch)
- A microservice platform or Kubernetes deployment
- A complex event-driven architecture

*Future extensions (like OCR or advanced reporting) are considered out-of-scope for the MVP.*
