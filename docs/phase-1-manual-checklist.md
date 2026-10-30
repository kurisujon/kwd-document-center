# Phase 1: Upload Drop Foundation — Manual Cross-Browser Checklist

This manual verification checklist complements automated JSDOM test suites by confirming real browser behavior that cannot be fully simulated in headless Node.js environments (specifically: native browser window navigation prevention, OS drag events, and cross-tab drag filtering).

---

## 1. Test Matrices

| Platform | Target Browsers | Input Methods |
|---|---|---|
| **Windows 10/11** | Google Chrome, Microsoft Edge, Mozilla Firefox | File Explorer Drag & Drop, Mouse Click, Keyboard (Tab + Space/Enter) |
| **macOS** | Apple Safari, Google Chrome, Mozilla Firefox | Finder Drag & Drop, Trackpad, Keyboard |
| **Mobile (iOS)** | Safari Mobile (iPhone / iPad) | Native File / Photo Library Picker, Tap |
| **Mobile (Android)** | Google Chrome Mobile | Native File Manager Picker, Tap |

---

## 2. Test Cases & Verification Steps

### Test Case 1: Drag & Drop into Upload Dropzone
- **Location**: `/documents/upload`
- **Steps**:
  1. Open File Explorer / Finder.
  2. Select 1 to 5 approved files (e.g. PDF, Word, Excel).
  3. Drag files over the dashed `.upload-dropzone` container.
- **Expected Outcome**:
  - The dropzone boundary highlights with Azure accent border (`.upload-dropzone-active`) and soft blue tint.
  - No flickering occurs when the cursor crosses child icons or typography.
  - Releasing the mouse button drops the files into the batch review table.
  - The browser **never** navigates away from the page or opens the file in the tab.

### Test Case 2: Stray Drop Outside the Dropzone (Window Drop Guard)
- **Location**: Any protected page (e.g. `/documents`, `/dashboard`, `/reports`)
- **Steps**:
  1. Drag a file from File Explorer / Finder over the sidebar, top header, or general page whitespace.
  2. Release the mouse button outside of any active drop target.
- **Expected Outcome**:
  - The drop is completely neutralized (`preventDefault`).
  - The browser **does not** open the file, download it, or leave the current route.

### Test Case 3: Page-Wide Drop Target on Documents Page
- **Location**: `/documents` (logged in as `STAFF` or `ADMIN`)
- **Steps**:
  1. Drag one or more document files from File Explorer over the `/documents` registry table.
- **Expected Outcome**:
  - A modal drop overlay appears: *"Drop files to open Upload Center"*.
  - Dropping the files immediately transitions the user to `/documents/upload` with those files pre-staged in the batch review list.
  - Logged in as `VIEWER`, the overlay does not activate.

### Test Case 4: Cross-Tab Text and URL Drag Filtering
- **Location**: `/documents/upload`
- **Steps**:
  1. Open a second browser tab or window.
  2. Highlight text or drag an image link / URL into the KWD dropzone.
- **Expected Outcome**:
  - Dropzone ignores the non-file drag or displays *"Only files can be dropped here."*
  - Zero rows are added to the batch review table.

### Test Case 5: Over-Limit Batch Drop Handling (25-File Ceiling)
- **Location**: `/documents/upload`
- **Steps**:
  1. Select 30 files in File Explorer.
  2. Drag and drop them onto the dropzone.
- **Expected Outcome**:
  - Exactly 25 files are staged in the review list.
  - A status banner indicates: *"Added 25 files. 5 files were skipped because batches are limited to 25."*

### Test Case 6: Duplicate File Detection within Drop
- **Location**: `/documents/upload`
- **Steps**:
  1. Prepare two files with identical names and identical byte sizes.
  2. Drop both files into the batch review.
- **Expected Outcome**:
  - The first file is staged with normal metadata prompt.
  - The second duplicate file is flagged with status `Invalid file` and error: *"Duplicate file in batch."*

### Test Case 7: Keyboard Navigation & Native File Picker Path
- **Location**: `/documents/upload`
- **Steps**:
  1. Navigate to the page using keyboard only (`Tab` key).
  2. Focus the dropzone element and press `Enter` or `Space`.
- **Expected Outcome**:
  - The native OS file selection dialog opens immediately.
  - Selecting files populates the batch review table identically to drag-and-drop.

### Test Case 8: Mobile Touchscreen Fallback
- **Location**: `/documents/upload` on iOS Safari or Android Chrome
- **Steps**:
  1. Tap the "Document files" dropzone tile.
- **Expected Outcome**:
  - The mobile operating system file sheet / document picker appears.
  - The user can select documents from device storage or cloud providers.
