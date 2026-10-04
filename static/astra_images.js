(function () {
  'use strict';

  var MAX_BYTES = 256 * 1024;
  var libraries = [];
  var controls = Object.create(null);

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function request(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || data.success === false) throw new Error(data.msg || 'Picture request failed.');
        return data;
      });
    });
  }

  function refresh() {
    return request('/api/images').then(function (data) {
      libraries = data.images || [];
      Object.keys(controls).forEach(renderControl);
      window.dispatchEvent(new CustomEvent('astra:images-updated', { detail: libraries }));
      return libraries;
    });
  }

  function renderControl(key) {
    var control = controls[key];
    var select = document.getElementById(control.selectId);
    if (!select) return;
    var selected = select.value || '';
    select.innerHTML = '<option value="">No picture selected</option>' + libraries.map(function (image) {
      return '<option value="' + image.id + '">' + esc(image.filename) + ' (' +
        Math.ceil(image.size_bytes / 1024) + ' KB)</option>';
    }).join('');
    if (libraries.some(function (image) { return String(image.id) === selected; })) select.value = selected;
    renderPreview(key);
  }

  function renderPreview(key) {
    var control = controls[key];
    var host = document.getElementById(control.previewId);
    if (!host) return;
    var image = libraries.find(function (item) {
      return String(item.id) === String(selected(key));
    });
    host.innerHTML = image
      ? '<img alt="' + esc(image.filename) + '" src="/api/images/' + image.id +
        '/content" style="max-width:96px;max-height:72px;object-fit:contain;border:1px solid var(--border-color);">' +
        '<span style="font-size:10px;color:#8a97ad;">' + esc(image.filename) + '</span>'
      : '';
  }

  function status(key, message) {
    var node = document.getElementById(controls[key].statusId);
    if (node) node.textContent = message || '';
  }

  function selected(key) {
    var control = controls[key];
    var select = control && document.getElementById(control.selectId);
    return select && select.value ? Number(select.value) : null;
  }

  function fileData(file) {
    return new Promise(function (resolve, reject) {
      if (typeof createImageBitmap !== 'function') {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { reject(new Error('Could not read the picture.')); };
        reader.readAsDataURL(file);
        return;
      }
      createImageBitmap(file).then(function (bitmap) {
        var scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        var qualities = [0.86, 0.78, 0.68, 0.58, 0.48];
        function encode(index) {
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('Could not encode the picture.')); return; }
            if (blob.size > MAX_BYTES && index + 1 < qualities.length) {
              encode(index + 1);
              return;
            }
            if (blob.size > MAX_BYTES) {
              reject(new Error('Picture is still larger than 256 KB after resizing.'));
              return;
            }
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result)); };
            reader.onerror = function () { reject(new Error('Could not read the resized picture.')); };
            reader.readAsDataURL(blob);
          }, 'image/jpeg', qualities[index]);
        }
        encode(0);
      }).catch(reject);
    });
  }

  function mount(containerId, key) {
    var container = document.getElementById(containerId);
    if (!container || controls[key]) return;
    var prefix = 'astraImage' + key.replace(/[^a-z0-9]/gi, '');
    controls[key] = {
      selectId: prefix + 'Select',
      previewId: prefix + 'Preview',
      statusId: prefix + 'Status'
    };
    var control = controls[key];
    container.innerHTML =
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
        '<label class="terminal-btn" for="' + prefix + 'File">[SAVE / ATTACH PICTURE]</label>' +
        '<input id="' + prefix + 'File" type="file" accept="image/jpeg,image/png,image/gif,image/webp" ' +
          'style="display:none;">' +
        '<select id="' + control.selectId + '" class="d-input" style="max-width:240px;">' +
          '<option value="">No picture selected</option></select>' +
        '<span id="' + control.statusId + '" style="font-size:10px;color:#8a97ad;"></span>' +
      '</div><div id="' + control.previewId + '" style="display:flex;align-items:center;gap:6px;margin-top:5px;"></div>';

    container.querySelector('#' + control.selectId).addEventListener('change', function () {
      renderPreview(key);
      status(key, '');
    });
    container.querySelector('#' + prefix + 'File').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      status(key, 'Resizing and saving...');
      fileData(file).then(function (dataUrl) {
        var bits = dataUrl.split(',', 2);
        var mime = (bits[0].match(/^data:([^;]+)/) || [])[1];
        return request('/api/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name || 'picture.jpg',
            mime: mime,
            data: bits[1]
          })
        });
      }).then(function (result) {
        return refresh().then(function () {
          container.querySelector('#' + control.selectId).value = String(result.image.id);
          renderPreview(key);
          status(key, 'Saved to your private Pictures library.');
        });
      }).catch(function (error) {
        status(key, error.message || 'Could not save picture.');
      }).finally(function () { event.target.value = ''; });
    });
    refresh().catch(function (error) { status(key, error.message); });
  }

  function initializeDefaultControls() {
    mount('clientImageAttach', 'clientPitch');
    mount('omniImageAttach', 'omniChat');
    mount('botImageAttach', 'botChat');
  }

  window.AstraImages = {
    mount: mount,
    selected: selected,
    clear: function (key) {
      var control = controls[key];
      var select = control && document.getElementById(control.selectId);
      if (select) select.value = '';
      renderPreview(key);
      status(key, '');
    },
    list: refresh,
    info: function (id) {
      return libraries.find(function (image) { return Number(image.id) === Number(id); }) || null;
    },
    show: function (id) {
      var image = this.info(id);
      if (!image) return;
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100200;background:rgba(0,0,0,.88);' +
        'display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;';
      overlay.innerHTML = '<img alt="' + esc(image.filename) + '" src="/api/images/' + image.id +
        '/content" style="max-width:100%;max-height:100%;object-fit:contain;">';
      overlay.addEventListener('click', function () { overlay.remove(); });
      document.body.appendChild(overlay);
    },
    remove: function (id) {
      return request('/api/images/' + id, { method: 'DELETE' }).then(refresh);
    },
    data: function (id) {
      var image = this.info(id);
      if (!image) return Promise.reject(new Error('Select a saved picture first.'));
      return fetch('/api/images/' + image.id + '/content').then(function (response) {
        if (!response.ok) throw new Error('Could not load the saved picture.');
        return response.blob().then(function (blob) {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
              resolve({ filename: image.filename, mime: image.mime, data: String(reader.result).split(',', 2)[1] });
            };
            reader.onerror = function () { reject(new Error('Could not read the saved picture.')); };
            reader.readAsDataURL(blob);
          });
        });
      });
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDefaultControls);
  } else {
    initializeDefaultControls();
  }
})();
