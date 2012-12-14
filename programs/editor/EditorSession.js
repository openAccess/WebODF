/**
 * @license
 * Copyright (C) 2012 KO GmbH <copyright@kogmbh.com>
 *
 * @licstart
 * The JavaScript code in this page is free software: you can redistribute it
 * and/or modify it under the terms of the GNU Affero General Public License
 * (GNU AGPL) as published by the Free Software Foundation, either version 3 of
 * the License, or (at your option) any later version.  The code is distributed
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU AGPL for more details.
 *
 * As additional permission under GNU AGPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * As a special exception to the AGPL, any HTML file which merely makes function
 * calls to this code, and for that purpose includes it by reference shall be
 * deemed a separate work for copyright law purposes. In addition, the copyright
 * holders of this code give you permission to combine this code with free
 * software libraries that are released under the GNU LGPL. You may copy and
 * distribute such a system following the terms of the GNU AGPL for this code
 * and the LGPL for the libraries. If you modify this code, you may extend this
 * exception to your version of the code, but you are not obligated to do so.
 * If you do not wish to do so, delete this exception statement from your
 * version.
 *
 * This license applies to this entire compilation.
 * @licend
 * @source: http://www.webodf.org/
 * @source: http://gitorious.org/webodf/webodf/
 */
/*global define,runtime,gui,ops */
define("webodf/editor/EditorSession", [], function () {
    "use strict";

    runtime.loadClass("ops.SessionImplementation");
    runtime.loadClass("ops.NowjsOperationRouter");
    runtime.loadClass("ops.NowjsUserModel");
    runtime.loadClass("odf.OdfCanvas");
    runtime.loadClass("gui.CaretFactory");
    runtime.loadClass("gui.Caret");
    runtime.loadClass("gui.SessionController");
    runtime.loadClass("gui.SessionView");

    var EditorSession = function EditorSession(session, memberid) {
        var self = this,
            currentParagraphNode = null,
            currentNamedStyleName = null,
            currentStyleName = null,
            odfDocument = session.getOdfDocument(),
            textns = "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
            formatting = odfDocument.getFormatting(),
            eventListener = {};

        this.sessionController = new gui.SessionController(session, memberid);
        this.sessionView = new gui.SessionView(session, new gui.CaretFactory(self.sessionController));

        eventListener['userAdded'] = [];
        eventListener['userRemoved'] = [];
        eventListener['cursorMoved'] = [];
        eventListener['paragraphChanged'] = [];

        // Custom signals, that make sense in the Editor context. We do not want to expose webodf's ops signals to random bits of the editor UI. 
        session.subscribe(ops.SessionImplementation.signalCursorAdded, function(cursor) {
            self.emit('userAdded', cursor.getMemberId());
        });

        session.subscribe(ops.SessionImplementation.signalCursorRemoved, function(memberId) {
            self.emit('userRemoved', memberId);
        });

        session.subscribe(ops.SessionImplementation.signalCursorMoved, function(cursor) {
            // Emit 'cursorMoved' only when *I* am moving the cursor, not the other users
            if (cursor.getMemberId() == memberid)
                self.emit('cursorMoved', cursor);
        });

        session.subscribe(ops.SessionImplementation.signalParagraphChanged, trackCurrentParagraph);

        function checkParagraphStyleName() {
            var newStyleName,
                newNamedStyleName;

            newStyleName = currentParagraphNode.getAttributeNS(textns, 'style-name');
            if (newStyleName !== currentStyleName) {
                currentStyleName = newStyleName;
                // check if named style is still the same
                newNamedStyleName = formatting.getFirstNamedParentStyleNameOrSelf(newStyleName);
                if (!newNamedStyleName) {
                    // TODO: how to handle default styles?
                    return;
                }
                // a named style
                if (newNamedStyleName !== currentNamedStyleName) {
                    currentNamedStyleName = newNamedStyleName;
                    self.emit('paragraphChanged', {
                        type: 'style',
                        node: currentParagraphNode,
                        styleName: currentNamedStyleName
                    });
                }
            }
        }

        function trackCursor(cursor) {
            var node;

            node = odfDocument.getParagraphElement(cursor.getSelection().focusNode);
            if (!node) {
                return;
            }
            currentParagraphNode = node;
            checkParagraphStyleName();
        }

        function trackCurrentParagraph(paragraphNode) {
            if (paragraphNode !== currentParagraphNode) {
                return;
            }
            checkParagraphStyleName();
        }

        this.startEditing = function () {
            self.sessionController.startEditing();
        };

        this.endEditing = function () {
            self.sessionController.endEditing();
        };

        this.emit = function (eventid, args) {
            var i, subscribers;
            runtime.assert(eventListener.hasOwnProperty(eventid),
                "unknown event fired \"" + eventid + "\"");
            subscribers = eventListener[eventid];
            runtime.log("firing event \"" + eventid + "\" to " + subscribers.length + " subscribers.");
            for (i = 0; i < subscribers.length; i += 1) {
                subscribers[i](args);
            }
        };

        this.subscribe = function (eventid, cb) {
            runtime.assert(eventListener.hasOwnProperty(eventid),
                "tried to subscribe to unknown event \"" + eventid + "\"");
            eventListener[eventid].push(cb);
            runtime.log("event \"" + eventid + "\" subscribed.");
        };

        this.getUserDetails = function(memberId) {
            return session.getUserModel().getUserDetails(memberId);
        };

        this.getCursorPosition = function() {
            return odfDocument.getCursorPosition(memberid);
        };

        this.getDocument = function() {
            return odfDocument;
        };

        this.getCurrentParagraph = function() {
            return currentParagraphNode;
        };

        this.getAvailableParagraphStyles = function() {
            return formatting.getAvailableParagraphStyles();
        };

        this.getCurrentParagraphStyle = function() {
            return currentNamedStyleName;
        };

        this.setCurrentParagraphStyle = function(value) {
            var op;
            if (currentNamedStyleName !== value) {
                op = new ops.OpSetParagraphStyle(session);
                op.init({
                    memberid: memberid,
                    position: self.getCursorPosition(),
                    styleNameBefore: currentNamedStyleName,
                    styleNameAfter: value
                });
                session.enqueue(op);
            }
        };

        this.subscribe('cursorMoved', trackCursor);
    };

    return EditorSession;
});