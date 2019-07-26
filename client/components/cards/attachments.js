Template.attachmentsGalery.events({
  'click .js-add-attachment': Popup.open('cardAttachments'),
  'click .js-confirm-delete': Popup.afterConfirm(
    'attachmentDelete',
    function() {
      Attachments.remove(this._id);
      Popup.close();
    },
  ),
  // If we let this event bubble, FlowRouter will handle it and empty the page
  // content, see #101.
  'click .js-download'(event) {
    event.stopPropagation();
  },
  'click .js-add-cover'() {
    Cards.findOne(this.cardId).setCover(this._id);
  },
  'click .js-remove-cover'() {
    Cards.findOne(this.cardId).unsetCover();
  },
  'click .js-preview-image'(event) {
    Popup.open('previewAttachedImage').call(this, event);
    // when multiple thumbnails, if click one then another very fast,
    // we might get a wrong width from previous img.
    // when popup reused, onRendered() won't be called, so we cannot get there.
    // here make sure to get correct size when this img fully loaded.
    const img = $('img.preview-large-image')[0];
    if (!img) return;
    const rePosPopup = () => {
      const w = img.width;
      const h = img.height;
      // if the image is too large, we resize & center the popup.
      if (w > 300) {
        $('div.pop-over').css({
          width: w + 20,
          position: 'absolute',
          left: (window.innerWidth - w) / 2,
          top: (window.innerHeight - h) / 2,
        });
      }
    };
    const url = $(event.currentTarget).attr('src');
    if (img.src === url && img.complete) rePosPopup();
    else img.onload = rePosPopup;
  },
});

Template.previewAttachedImagePopup.events({
  'click .js-large-image-clicked'() {
    Popup.close();
  },
});

Template.cardAttachmentsPopup.events({
  'change .js-attach-file'(event) {
    const card = this;
    const processFile = f => {
      const file = new FS.File(f);
      if (card.isLinkedCard()) {
        file.boardId = Cards.findOne(card.linkedId).boardId;
        file.cardId = card.linkedId;
      } else {
        file.boardId = card.boardId;
        file.swimlaneId = card.swimlaneId;
        file.listId = card.listId;
        file.cardId = card._id;
      }
      file.userId = Meteor.userId();
      const attachment = Attachments.insert(file);

      if (attachment && attachment._id && attachment.isImage()) {
        card.setCover(attachment._id);
      }

      Popup.close();
    };

    FS.Utility.eachFile(event, f => {
      if (
        MAX_IMAGE_PIXEL > 0 &&
        typeof f.type === 'string' &&
        f.type.match(/^image/)
      ) {
        // is image
        const reader = new FileReader();
        reader.onload = function(e) {
          const dataurl = e && e.target && e.target.result;
          if (dataurl !== undefined) {
            shrinkImage({
              dataurl,
              maxSize: MAX_IMAGE_PIXEL,
              ratio: COMPRESS_RATIO,
              toBlob: true,
              callback(blob) {
                if (blob === false) {
                  processFile(f);
                } else {
                  blob.name = f.name;
                  processFile(blob);
                }
              },
            });
          } else {
            // couldn't process it let other function handle it?
            processFile(f);
          }
        };
        reader.readAsDataURL(f);
      } else {
        processFile(f);
      }
    });
  },
  'click .js-computer-upload'(event, templateInstance) {
    templateInstance.find('.js-attach-file').click();
    event.preventDefault();
  },
  'click .js-upload-clipboard-image': Popup.open('previewClipboardImage'),
});

const MAX_IMAGE_PIXEL = Meteor.settings.public.MAX_IMAGE_PIXEL;
const COMPRESS_RATIO = Meteor.settings.public.IMAGE_COMPRESS_RATIO;
let pastedResults = null;
const shrinkImage = function(options) {
  // shrink image to certain size
  const dataurl = options.dataurl,
    callback = options.callback,
    toBlob = options.toBlob;
  let canvas = document.createElement('canvas'),
    image = document.createElement('img');
  const maxSize = options.maxSize || 1024;
  const ratio = options.ratio || 1.0;
  const next = function(result) {
    image = null;
    canvas = null;
    if (typeof callback === 'function') {
      callback(result);
    }
  };
  image.onload = function() {
    let width = this.width,
      height = this.height;
    let changed = false;
    if (width > height) {
      if (width > maxSize) {
        height *= maxSize / width;
        width = maxSize;
        changed = true;
      }
    } else if (height > maxSize) {
      width *= maxSize / height;
      height = maxSize;
      changed = true;
    }
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(this, 0, 0, width, height);
    if (changed === true) {
      const type = 'image/jpeg';
      if (toBlob) {
        canvas.toBlob(next, type, ratio);
      } else {
        next(canvas.toDataURL(type, ratio));
      }
    } else {
      next(changed);
    }
  };
  image.onerror = function() {
    next(false);
  };
  image.src = dataurl;
};

Template.previewClipboardImagePopup.onRendered(() => {
  // we can paste image from clipboard
  const handle = results => {
    if (results.dataURL.startsWith('data:image/')) {
      const direct = results => {
        $('img.preview-clipboard-image').attr('src', results.dataURL);
        pastedResults = results;
      };
      if (MAX_IMAGE_PIXEL) {
        // if has size limitation on image we shrink it before uploading
        shrinkImage({
          dataurl: results.dataURL,
          maxSize: MAX_IMAGE_PIXEL,
          ratio: COMPRESS_RATIO,
          callback(changed) {
            if (changed !== false && !!changed) {
              results.dataURL = changed;
            }
            direct(results);
          },
        });
      }
    }
  };

  $(document.body).pasteImageReader(handle);

  // we can also drag & drop image file to it
  $(document.body).dropImageReader(handle);
});

Template.previewClipboardImagePopup.events({
  'click .js-upload-pasted-image'() {
    const results = pastedResults;
    if (results && results.file) {
      window.oPasted = pastedResults;
      const card = this;
      const file = new FS.File(results.file);
      if (!results.name) {
        // if no filename, it's from clipboard. then we give it a name, with ext name from MIME type
        if (typeof results.file.type === 'string') {
          file.name(results.file.type.replace('image/', 'clipboard.'));
        }
      }
      file.updatedAt(new Date());
      file.boardId = card.boardId;
      file.cardId = card._id;
      file.userId = Meteor.userId();
      const attachment = Attachments.insert(file);

      if (attachment && attachment._id && attachment.isImage()) {
        card.setCover(attachment._id);
      }

      pastedResults = null;
      $(document.body).pasteImageReader(() => {});
      Popup.close();
    }
  },
});
