/**
 * @method DataMan
 * @public
 * @constructor
 * @param {File|Blob|ArrayBuffer|Uint8Array|String} data The data that you want to manipulate.
 * @param {String} [type] The data content (MIME) type, if known. Required if the first argument is an ArrayBuffer, Uint8Array, or URL
 */
DataMan = function DataMan(data, type) {
  var self = this;

  // The end result of all this is that we will have one of the following set:
  // - self.blob
  // - self.dataUri
  // - self.url
  // Unless we already have in-memory data, we don't load anything into memory
  // and instead rely on obtaining a read stream when the time comes.
  if (typeof File !== "undefined" && data instanceof File) {
    self.blob = data; // File inherits from Blob so this is OK
    self.type = data.type;
  } else if (typeof Blob !== "undefined" && data instanceof Blob) {
    self.blob = data;
    self.type = data.type;
  } else if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer || EJSON.isBinary(data)) {
    if (typeof Blob === "undefined") {
      throw new Error("Browser must support Blobs to handle an ArrayBuffer or Uint8Array");
    }
    self.blob = new Blob([data], {type: type});
    self.type = type;
  } else if (typeof data === "string") {
    if (data.slice(0, 5) === "data:") {
      self.dataUri = data;
      self.type = data.slice(5, data.indexOf(';'));
    } else if (data.slice(0, 5) === "http:" || data.slice(0, 6) === "https:") {
      self.url = data;
      self.type = type;
    } else {
      throw new Error("DataMan constructor received unrecognized data string");
    }
  } else {
    throw new Error("DataMan constructor received data that it doesn't support");
  }
};

/**
 * @method DataMan.prototype.getBlob
 * @public
 * @param {Function} callback - callback(error, blob)
 * @returns {undefined}
 *
 * Passes a Blob representing this data to a callback.
 */
DataMan.prototype.getBlob = function dataManGetBlob(callback) {
  var self = this;
  if (self.blob) {
    callback(null, self.blob);
  } else if (self.dataUri) {
    self.blob = dataURItoBlob(self.dataUri, self.type);
    callback(null, self.blob);
  } else if (self.url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', self.url, true);
    xhr.responseType = "blob";
    xhr.onload = function(data) {
      self.blob = xhr.response;
      callback(null, self.blob);
    };
    xhr.onerror = function(err) {
      callback(err);
    };
    xhr.send();
  }
};

/**
 * @method DataMan.prototype.getBinary
 * @public
 * @param {Number} [start] - First byte position to read.
 * @param {Number} [end] - Last byte position to read.
 * @param {Function} callback - callback(error, binaryData)
 * @returns {undefined}
 *
 * Passes a Uint8Array representing this data to a callback.
 */
DataMan.prototype.getBinary = function dataManGetBinary(start, end, callback) {
  var self = this;

  if (typeof start === "function") {
    callback = start;
  }
  callback = callback || defaultCallback;

  function read(blob) {
    if (typeof FileReader === "undefined") {
      callback(new Error("Browser does not support FileReader"));
      return;
    }

    var reader = new FileReader();
    reader.onload = function(evt) {
      callback(null, new Uint8Array(evt.target.result));
    };
    reader.onerror = function(err) {
      callback(err);
    };
    reader.readAsArrayBuffer(blob);
  }

  self.getBlob(function (error, blob) {
    if (error) {
      callback(error);
    } else {
      if (typeof start === "number" && typeof end === "number") {
        var size = blob.size;
        // Return the requested chunk of binary data
        if (start >= size) {
          callback(new Error("DataMan.getBinary: start position beyond end of data (" + size + ")"));
          return;
        }
        end = Math.min(size, end);

        var slice = blob.slice || blob.webkitSlice || blob.mozSlice;
        if (typeof slice === 'undefined') {
          callback(new Error('Browser does not support File.slice'));
          return;
        }

        read(slice.call(blob, start, end, self.type));
      } else {
        // Return the entire binary data
        read(blob);
      }
    }
  });

};

/** @method DataMan.prototype.saveAs
 * @public
 * @param {String} [filename]
 * @return {undefined}
 *
 * Tells the browser to save the data like a normal downloaded file,
 * using the provided filename.
 *
 */
DataMan.prototype.saveAs = function dataManSaveAs(filename) {
  var self = this;

  if (typeof window === "undefined")
    throw new Error("window must be defined to use saveLocal");

  self.getBlob(function (error, blob) {
    if (error) {
      throw error;
    } else {
      window.saveAs(blob, filename);
    }
  });
};

/**
 * @method DataMan.prototype.getDataUri
 * @public
 * @param {function} callback callback(err, dataUri)
 */
DataMan.prototype.getDataUri = function dataManGetDataUri(callback) {
  // XXX: We could consider using: URL.createObjectURL(blob);
  // This will create a reference to the blob data instead of a clone
  // This is part of the File API - as the rest - Not sure how to generally
  // support from IE10, FF26, Chrome 31, safari 7, opera 19, ios 6, android 4

  var self = this;

  if (typeof callback !== 'function')
    throw new Error("getDataUri requires callback function");

  if (typeof FileReader === "undefined") {
    callback(new Error("Browser does not support FileReader"));
    return;
  }

  var fileReader = new FileReader();
  fileReader.onload = function(event) {
    self.dataUri = event.target.result;
    callback(null, self.dataUri);
  };
  fileReader.onerror = function(err) {
    callback(err);
  };

  self.getBlob(function (error, blob) {
    if (error) {
      callback(error);
    } else {
      fileReader.readAsDataURL(blob);
    }
  });
};

DataMan.prototype.size = function dataManSize(callback) {
  var self = this;

  if (!callback) {
    throw new Error("On the client, DataMan.size requires a callback");
  }

  if (typeof self._size === "number") {
    return self._size;
  }

  return self.getBlob(function (error, blob) {
    if (error) {
      callback(error);
    } else {
      self._size = blob.size;
      callback(null, blob.size);
    }
  });
};

/**
 * @method dataURItoBlob
 * @private
 * @param {String} dataURI The data URI
 * @param {String} dataTYPE The content type
 * @returns {Blob} A new Blob instance
 *
 * Converts a data URI to a Blob.
 */
function dataURItoBlob(dataURI, dataTYPE) {
  var str = atob(dataURI.split(',')[1]), array = [];
  for(var i = 0; i < str.length; i++) array.push(str.charCodeAt(i));
  return new Blob([new Uint8Array(array)], {type: dataTYPE});
}

/**
 * @method defaultCallback
 * @private
 * @param {Error} [err]
 * @returns {undefined}
 *
 * Can be used as a default callback for client methods that need a callback.
 * Simply throws the provided error if there is one.
 */
function defaultCallback(err) {
  if (err) {
    // Show gentle error if Meteor error
    if (err instanceof Meteor.Error) {
      console.error(err.message);
    } else {
      // Normal error, just throw error
      throw err;
    }

  }
}
