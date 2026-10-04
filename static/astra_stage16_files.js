/* ===========================================================================
 * astra_stage16_files.js - Stage 16 (extended by Stage 17).
 *
 * A FILES app for the desktop. Its "files" are shortcuts into apps that
 * already exist (NOTEPAD, SYSTEM), plus a real DOWNLOADS folder that now
 * reflects the actual install pipeline astra_stage17_appstore2.js drives:
 * a download in progress, a finished .zip, an extracted folder holding a
 * setup.exe, and finally an installed .app shortcut - same lifecycle a real
 * downloads folder goes through, just simulated.
 *
 * Stage 17 needed one thing Stage 16 didn't have: somewhere to put files
 * that don't map 1:1 onto an existing app view (a .zip isn't an app, a
 * folder isn't an app, setup.exe isn't an app - only the *installed* result
 * is). So DOWNLOADS is now driven by two merged sources: the store's own
 * "already installed" list (unchanged from Stage 16) plus a small public
 * registry (window.AstraFiles.pushDownload/updateDownload/removeDownload)
 * that Stage 17 owns and writes into. Entries can now be folders (children
 * array) so the extracted app folder can hold its own setup.exe one level
 * down, with basic breadcrumb navigation - the only real "nested filesystem"
 * bit this app has ever needed.
 *
 * SYSTEM app (astra_stage14_appstore.js's SYSTEM_APPS includes 'files') -
 * ships pre-installed, same reasoning as BROWSER: nothing to browse to
 * without it.
 * =========================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function addNavButton(id, label) {
    var nav = document.querySelector('.header-nav');
    if (!nav || $('nav-' + id)) return null;
    var btn = document.createElement('button');
    btn.className = 'terminal-btn';
    btn.id = 'nav-' + id;
    btn.textContent = label;
    btn.onclick = function () { window.switchView(id); };
    var settings = $('nav-settings');
    if (settings) nav.insertBefore(btn, settings); else nav.appendChild(btn);
    return btn;
  }

  // ---- dynamic downloads registry (written by astra_stage17_appstore2.js) --
  var dynamicDownloads = []; // array of {id, name, hint, icon, progress(0-100|null), isFolder, children, action:{label,run}, open}
  var savedPictures = [];

  function pushDownload(entry) {
    dynamicDownloads = dynamicDownloads.filter(function (e) { return e.id !== entry.id; });
    dynamicDownloads.unshift(entry);
    render();
  }
  function findEntry(id, list) {
    list = list || dynamicDownloads;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
      if (list[i].children) {
        var found = findEntry(id, list[i].children);
        if (found) return found;
      }
    }
    return null;
  }
  function updateDownload(id, patch) {
    var e = findEntry(id);
    if (!e) return;
    for (var k in patch) e[k] = patch[k];
    render();
  }
  function removeDownload(id) {
    dynamicDownloads = dynamicDownloads.filter(function (e) { return e.id !== id; });
    render();
    if (window.AstraDesktopState) {
      var saved = window.AstraDesktopState.get().downloads || [];
      return window.AstraDesktopState.update({ downloads: saved.filter(function (e) { return e.id !== id; }) });
    }
    return Promise.resolve(null);
  }
  function recordExport(filename) {
    var entry = {
      id: 'export-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      name: filename, kind: 'export', phase: 'exported', icon: '\u2197', hint: 'Exported file'
    };
    pushDownload(entry);
    if (window.AstraDesktopState) {
      var saved = window.AstraDesktopState.get().downloads || [];
      saved.push({ id: entry.id, kind: 'export', name: filename, phase: 'exported' });
      window.AstraDesktopState.update({ downloads: saved.slice(-100) });
    }
  }

  var FOLDERS = {
    documents: {
      label: 'DOCUMENTS',
      files: function () {
        var ta = $('operatorNotepad');
        var preview = ta && ta.value ? ta.value.slice(0, 60).replace(/\n/g, ' ') : '(empty)';
        return [{ id: 'doc-notes', name: 'notepad.txt', hint: preview, open: function () { if (window.switchView) window.switchView('notes'); } }];
      }
    },
    downloads: {
      label: 'DOWNLOADS',
      files: function () {
        var store = window.AstraAppStore;
        var installed = store ? store.catalog().filter(function (e) { return store.isInstalled(e.id); }).map(function (e) {
          return {
            id: 'installed-' + e.id, name: e.name.toLowerCase().replace(/\s+/g, '_') + '.app',
            icon: '\u2713', hint: e.blurb + ' (installed)',
            open: function () { if (window.switchView) window.switchView(e.id); }
          };
        }) : [];
        return dynamicDownloads.concat(installed);
      }
    },
    system: {
      label: 'SYSTEM',
      files: function () {
        return [
          { id: 'sys-settings', name: 'settings.sys', hint: 'Terminal preferences', open: function () { if (window.switchView) window.switchView('settings'); } },
          { id: 'sys-profile', name: 'profile.dat', hint: 'Your operator profile', open: function () { if (window.switchView) window.switchView('profile'); } }
        ];
      }
    },
    account: {
      label: 'ACCOUNT SAVES',
      files: function () { return accountItems(''); }
    },
    photos: {
      label: 'PICTURES',
      files: function () {
        return savedPictures.map(function (image) {
          return {
            id: 'picture-' + image.id, imageId: image.id, name: image.filename,
            icon: '\u25A7', hint: Math.ceil(image.size_bytes / 1024) + ' KB \u00B7 private to this account',
            open: function () { if (window.AstraImages) window.AstraImages.show(image.id); },
            action: {
              label: 'DELETE',
              run: function () {
                if (!window.confirm('Delete ' + image.filename + ' from your picture library?')) return;
                window.AstraImages.remove(image.id).then(function (images) {
                  savedPictures = images;
                  render();
                }).catch(function (error) { window.alert(error.message); });
              }
            }
          };
        });
      }
    }
  };

  var currentFolder = 'documents';
  var pathStack = []; // stack of {name, children} when browsing inside a folder-type entry

  function viewHtml() {
    var tabs = Object.keys(FOLDERS).map(function (key) {
      return '<button class="terminal-btn" id="filesTab-' + key + '" onclick="AstraFiles.open(\'' + key + '\')">' + FOLDERS[key].label + '</button>';
    }).join('');
    return '' +
      '<div class="terminal-panel">' +
        '<div class="panel-header"><div class="panel-heading-title">FILES</div></div>' +
        '<div style="display:flex; gap:6px; margin-bottom:10px;">' + tabs + '</div>' +
        '<div id="accountTools" style="display:none;margin-bottom:8px;"><button class="terminal-btn" onclick="AstraFiles.newAccountFile()">NEW ACCOUNT FILE</button>' +
          '<span style="font-size:10px;color:#8a97ad;margin-left:6px;">Private to this account; syncs across your devices.</span></div>' +
        '<div id="photosTools" style="display:none;margin-bottom:8px;"><div id="filesPhotoAttach"></div>' +
          '<span style="font-size:10px;color:#8a97ad;">Private to this account; reuse saved pictures in client, investor, OMNI, and bot conversations.</span></div>' +
        '<div id="filesBreadcrumb" style="font-size:10px; color:#5c7a99; margin-bottom:6px;"></div>' +
        '<div id="filesListing" style="display:flex; flex-direction:column; gap:6px;"></div>' +
        '<div id="accountFileEditor" style="display:none;margin-top:10px;border-top:1px solid var(--border-color);padding-top:8px;">' +
          '<label for="accountFilePath" style="display:block;font-size:10px;color:#8a97ad;margin-bottom:4px;">FILE PATH (use folder/name.txt to group files)</label>' +
          '<input id="accountFilePath" maxlength="160" placeholder="notes/ideas.txt" style="width:100%;margin-bottom:6px;">' +
          '<textarea id="accountFileContent" maxlength="50000" rows="7" placeholder="Text saved to your account..." style="width:100%;resize:vertical;"></textarea>' +
          '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;"><button class="terminal-btn" onclick="AstraFiles.saveAccountFile()">SAVE TO ACCOUNT</button>' +
          '<button class="terminal-btn" onclick="AstraFiles.closeAccountEditor()">CLOSE</button><span id="accountFileStatus" style="font-size:10px;color:#8a97ad;"></span></div>' +
        '</div>' +
      '</div>';
  }

  function accountItems(prefix) {
    var state = window.AstraDesktopState ? window.AstraDesktopState.get() : {};
    var saved = state.saved_files || [];
    var files = [], folders = {};
    saved.forEach(function (file) {
      var path = file.path.replace(/\\/g, '/');
      if (prefix && path.indexOf(prefix) !== 0) return;
      var relative = path.slice(prefix.length);
      var slash = relative.indexOf('/');
      if (slash >= 0) folders[relative.slice(0, slash)] = true;
      else files.push({
        id: 'account-file-' + files.length, name: relative, accountPath: path,
        hint: file.content ? file.content.slice(0, 80).replace(/\n/g, ' ') : '(empty file)',
        open: function () { editAccountFile(path, file.content); }
      });
    });
    Object.keys(folders).sort().forEach(function (name) {
      var path = prefix + name + '/';
      files.unshift({ id: 'account-folder-' + path, name: name, isFolder: true, children: accountItems(path) });
    });
    return files;
  }

  function editAccountFile(path, content) {
    var editor = $('accountFileEditor');
    if (!editor) return;
    $('accountFilePath').value = path || '';
    $('accountFileContent').value = content || '';
    $('accountFileStatus').textContent = '';
    editor.style.display = '';
  }

  function saveAccountFile() {
    var desktop = window.AstraDesktopState;
    if (!desktop) return;
    var path = $('accountFilePath').value.trim().replace(/\\/g, '/');
    var content = $('accountFileContent').value;
    var parts = path.split('/');
    if (!path || path.length > 160 || path.charAt(0) === '/' || parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
      $('accountFileStatus').textContent = 'Choose a valid relative file path.';
      return;
    }
    if (content.length > 50000) {
      $('accountFileStatus').textContent = 'Files are limited to 50 KB.';
      return;
    }
    var files = (desktop.get().saved_files || []).filter(function (file) { return file.path !== path; });
    files.push({ path: path, content: content });
    if (files.length > 100 || files.reduce(function (size, file) { return size + file.content.length; }, 0) > 500000) {
      $('accountFileStatus').textContent = 'Account file storage limit reached.';
      return;
    }
    desktop.update({ saved_files: files }).then(function (result) {
      $('accountFileStatus').textContent = result && result.success ? 'Saved to account.' : 'Could not sync file.';
      if (result && result.success) render();
    });
  }

  function deleteAccountFile(index) {
    var file = currentList()[index];
    var desktop = window.AstraDesktopState;
    if (!file || !file.accountPath || !desktop || !window.confirm('Delete ' + file.accountPath + ' from this account?')) return;
    var files = (desktop.get().saved_files || []).filter(function (entry) { return entry.path !== file.accountPath; });
    desktop.update({ saved_files: files }).then(function (result) {
      if (result && result.success) render();
    });
  }

  function currentList() {
    if (pathStack.length) return pathStack[pathStack.length - 1].children;
    return FOLDERS[currentFolder].files();
  }

  function loadPictures() {
    if (!window.AstraImages) return;
    window.AstraImages.list().then(function (images) {
      savedPictures = images;
      if (currentFolder === 'photos') render();
    }).catch(function (error) {
      var listing = $('filesListing');
      if (listing && currentFolder === 'photos') {
        listing.innerHTML = '<div style="color:var(--pixel-red);font-size:11px;">' + esc(error.message) + '</div>';
      }
    });
  }

  function render() {
    var listing = $('filesListing');
    if (!listing) return;
    Object.keys(FOLDERS).forEach(function (key) {
      var tab = $('filesTab-' + key);
      if (tab) tab.classList.toggle('active-nav', key === currentFolder && !pathStack.length);
    });
    var crumb = $('filesBreadcrumb');
    if (crumb) {
      var parts = [FOLDERS[currentFolder].label].concat(pathStack.map(function (p) { return p.name; }));
      crumb.textContent = parts.join(' \u203A ');
    }
    var tools = $('accountTools');
    if (tools) tools.style.display = currentFolder === 'account' && !pathStack.length ? '' : 'none';
    var photosTools = $('photosTools');
    if (photosTools) photosTools.style.display = currentFolder === 'photos' && !pathStack.length ? '' : 'none';
    var files = currentList();
    var rows = [];
    if (pathStack.length) {
      rows.push('<div class="d-list-item" style="cursor:pointer; opacity:.8;" onclick="AstraFiles.up()">' +
        '<span style="color:var(--pixel-cyan);">\u2190 .. (back)</span></div>');
    }
    if (!files.length) {
      rows.push('<div style="color:#888; font-size:11px;">This folder is empty.</div>');
    } else {
      files.forEach(function (f, i) {
        var icon = f.icon || (f.isFolder ? '\uD83D\uDCC1' : '\u2637');
        var progressBar = (typeof f.progress === 'number' && f.progress < 100)
          ? '<div style="height:4px; background:#112; margin-top:4px; width:160px;"><div style="height:100%; width:' + f.progress + '%; background:var(--pixel-cyan); transition:width .2s;"></div></div>'
          : '';
        var actionBtn;
        if (f.accountPath) {
          actionBtn = '<button class="terminal-btn" onclick="AstraFiles.openFile(' + i + ')">OPEN</button>' +
            '<button class="terminal-btn" onclick="AstraFiles.deleteAccountFile(' + i + ')">DELETE</button>';
        } else if (f.action) {
          actionBtn = '<button class="terminal-btn btn-action" onclick="AstraFiles.runAction(' + i + ')">' + esc(f.action.label) + '</button>';
        } else if (typeof f.progress === 'number' && f.progress < 100) {
          actionBtn = '<span class="terminal-btn" style="opacity:.5; cursor:default;">' + f.progress + '%</span>';
        } else if (f.isFolder) {
          actionBtn = '<button class="terminal-btn" onclick="AstraFiles.openFile(' + i + ')">OPEN</button>';
        } else if (f.open) {
          actionBtn = '<button class="terminal-btn" onclick="AstraFiles.openFile(' + i + ')">OPEN</button>';
        } else {
          actionBtn = '';
        }
        rows.push('<div class="d-list-item">' +
          '<div><span style="color:var(--pixel-cyan);">' + icon + ' ' + esc(f.name) + '</span>' +
          '<div style="font-size:9.5px; color:#888;">' + esc(f.hint || '') + '</div>' + progressBar + '</div>' +
          (f.imageId ? '<span><button class="terminal-btn" onclick="AstraFiles.openFile(' + i + ')">VIEW</button>' + actionBtn + '</span>' : actionBtn) + '</div>');
      });
    }
    listing.innerHTML = rows.join('');
    listing._files = files;
  }

  window.AstraFiles = {
    open: function (key) {
      if (!FOLDERS[key]) return;
      currentFolder = key; pathStack = []; render();
      if (key === 'photos') loadPictures();
    },
    up: function () { pathStack.pop(); render(); },
    openFile: function (i) {
      var files = currentList();
      var f = files && files[i];
      if (!f) return;
      if (f.isFolder) { pathStack.push({ name: f.name, children: f.children || [] }); render(); return; }
      if (f.open) f.open();
    },
    runAction: function (i) {
      var files = currentList();
      var f = files && files[i];
      if (f && f.action && f.action.run) f.action.run();
    },
    // Public registry for astra_stage17_appstore2.js.
    pushDownload: pushDownload,
    updateDownload: updateDownload,
    removeDownload: removeDownload,
    recordExport: recordExport,
    newAccountFile: function () { editAccountFile('', ''); },
    saveAccountFile: saveAccountFile,
    closeAccountEditor: function () { var editor = $('accountFileEditor'); if (editor) editor.style.display = 'none'; },
    deleteAccountFile: deleteAccountFile,
    goto: function (folderKey) { this.open(folderKey); if (window.switchView) window.switchView('files'); }
  };

  var done = false;
  function build() {
    if (done) return;
    var host = $('view-dashboard');
    var wrapper = (host && host.parentNode) || $('mainAppWrapper');
    if (!host || !wrapper) return;
    var view = document.createElement('div');
    view.id = 'view-files';
    view.className = 'app-view';
    view.innerHTML = viewHtml();
    wrapper.insertBefore(view, host);
    if (window.AstraImages) window.AstraImages.mount('filesPhotoAttach', 'savedPhotos');
    addNavButton('files', '[\u2637] FILES');
    render();
    window.addEventListener('astra:desktop-state', render);
    window.addEventListener('astra:images-updated', function (event) {
      savedPictures = event.detail || [];
      if (currentFolder === 'photos') render();
    });
    done = true;
    if (window.winosRescanApps) window.winosRescanApps();
  }

  function waitAndRun(triesLeft) {
    if (document.querySelector('.header-nav') || triesLeft <= 0) { build(); return; }
    setTimeout(function () { waitAndRun(triesLeft - 1); }, 150);
  }

  window.addEventListener('astrax:ready', function () { waitAndRun(40); });
  setTimeout(function () { waitAndRun(1); }, 8500);
})();
