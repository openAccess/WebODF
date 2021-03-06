/**
 * Copyright (C) 2013 KO GmbH <copyright@kogmbh.com>
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

/*global runtime, core, gui, odf, ops, Node */

runtime.loadClass("core.DomUtils");
runtime.loadClass("core.PositionFilterChain");
runtime.loadClass("gui.SelectionMover");
runtime.loadClass("odf.OdfUtils");
runtime.loadClass("ops.OdtCursor");
runtime.loadClass("ops.OpMoveCursor");
runtime.loadClass("ops.Session");
runtime.loadClass("ops.StepsTranslator");

/**
 * @constructor
 * @param {!ops.Session} session
 * @param {!string} inputMemberId
 */
gui.SelectionController = function SelectionController(session, inputMemberId) {
    "use strict";
    var odtDocument = session.getOdtDocument(),
        domUtils = new core.DomUtils(),
        odfUtils = new odf.OdfUtils(),
        baseFilter = odtDocument.getPositionFilter(),
        keyboardMovementsFilter = new core.PositionFilterChain();

    keyboardMovementsFilter.addFilter('BaseFilter', baseFilter);
    keyboardMovementsFilter.addFilter('RootFilter', odtDocument.createRootFilter(inputMemberId));

    /**
     * @param {Function} lookup
     * @returns {!function(!Node, !number):!function(!number, !Node, !number):!boolean}
     */
    /*jslint unparam:true*/
    function constrain(lookup) {
        return function (originalNode) {
            var originalContainer = lookup(originalNode);
            return function (step, node) {
                return lookup(node) === originalContainer;
            };
        };
    }
    /*jslint unparam:false*/

    /**
     * Derive a selection-type object from the provided cursor
     * @param {!{anchorNode: Node, anchorOffset: !number, focusNode: Node, focusOffset: !number}} selection
     * @returns {{range: !Range, hasForwardSelection: !boolean}}
     */
    function selectionToRange(selection) {
        var hasForwardSelection = domUtils.comparePoints(/**@type{!Node}*/(selection.anchorNode), selection.anchorOffset,
                /**@type{!Node}*/(selection.focusNode), selection.focusOffset) >= 0,
            range = selection.focusNode.ownerDocument.createRange();
        if (hasForwardSelection) {
            range.setStart(selection.anchorNode, selection.anchorOffset);
            range.setEnd(selection.focusNode, selection.focusOffset);
        } else {
            range.setStart(selection.focusNode, selection.focusOffset);
            range.setEnd(selection.anchorNode, selection.anchorOffset);
        }
        return {
            range: range,
            hasForwardSelection: hasForwardSelection
        };
    }
    this.selectionToRange = selectionToRange;

    /**
     * Derive a selection-type object from the provided cursor
     * @param {!Range} range
     * @param {!boolean} hasForwardSelection
     * @returns {!{anchorNode: !Node, anchorOffset: !number, focusNode: !Node, focusOffset: !number}}
     */
    function rangeToSelection(range, hasForwardSelection) {
        if (hasForwardSelection) {
            return {
                anchorNode: /**@type{!Node}*/(range.startContainer),
                anchorOffset: range.startOffset,
                focusNode: /**@type{!Node}*/(range.endContainer),
                focusOffset: range.endOffset
            };
        }
        return {
            anchorNode: /**@type{!Node}*/(range.endContainer),
            anchorOffset: range.endOffset,
            focusNode: /**@type{!Node}*/(range.startContainer),
            focusOffset: range.startOffset
        };
    }
    this.rangeToSelection = rangeToSelection;

    /**
     * @param {!number} position
     * @param {!number} length
     * @param {string=} selectionType
     * @return {!ops.Operation}
     */
    function createOpMoveCursor(position, length, selectionType) {
        var op = new ops.OpMoveCursor();
        op.init({
            memberid: inputMemberId,
            position: position,
            length: length || 0,
            selectionType: selectionType
        });
        return op;
    }

    /**
     * @param {!Node} frameNode
     */
    function selectImage(frameNode) {
        var stepsToAnchor = odtDocument.getDistanceFromCursor(inputMemberId, frameNode, 0),
            stepsToFocus = stepsToAnchor !== null ? stepsToAnchor + 1 : null,
            oldPosition,
            op;

        if (stepsToFocus || stepsToAnchor) {
            oldPosition = odtDocument.getCursorPosition(inputMemberId);
            op = createOpMoveCursor(
                oldPosition + stepsToAnchor,
                stepsToFocus - stepsToAnchor,
                ops.OdtCursor.RegionSelection
            );
            session.enqueue([op]);
        }
    }
    this.selectImage = selectImage;

    /**
     * Expands the supplied selection to the nearest word boundaries
     * @param {!Range} range
     */
    function expandToWordBoundaries(range) {
        var alphaNumeric = /[A-Za-z0-9]/,
            iterator = gui.SelectionMover.createPositionIterator(odtDocument.getRootNode()),
            currentNode, c;

        iterator.setUnfilteredPosition(/**@type{!Node}*/(range.startContainer), range.startOffset);
        while (iterator.previousPosition()) {
            currentNode = iterator.getCurrentNode();
            if (currentNode.nodeType === Node.TEXT_NODE) {
                c = currentNode.data[iterator.unfilteredDomOffset()];
                if (!alphaNumeric.test(c)) {
                    break;
                }
            } else if (!odfUtils.isTextSpan(currentNode)) {
                break;
            }
            range.setStart(iterator.container(), iterator.unfilteredDomOffset());
        }

        iterator.setUnfilteredPosition(/**@type{!Node}*/(range.endContainer), range.endOffset);
        do {
            currentNode = iterator.getCurrentNode();
            if (currentNode.nodeType === Node.TEXT_NODE) {
                c = currentNode.data[iterator.unfilteredDomOffset()];
                if (!alphaNumeric.test(c)) {
                    break;
                }
            } else if (!odfUtils.isTextSpan(currentNode)) {
                break;
            }
        } while (iterator.nextPosition());
        range.setEnd(iterator.container(), iterator.unfilteredDomOffset());
    }
    this.expandToWordBoundaries = expandToWordBoundaries;

    /**
     * Expands the supplied selection to the nearest paragraph boundaries
     * @param {!Range} range
     */
    function expandToParagraphBoundaries(range) {
        var startParagraph = odtDocument.getParagraphElement(range.startContainer),
            endParagraph = odtDocument.getParagraphElement(range.endContainer);

        if (startParagraph) {
            range.setStart(startParagraph, 0);
        }

        if (endParagraph) {
            if (odfUtils.isParagraph(range.endContainer) && range.endOffset === 0) {
                // Chrome's built-in paragraph expansion will put the end of the selection
                // at (p,0) of the FOLLOWING paragraph. Round this back down to ensure
                // the next paragraph doesn't get incorrectly selected
                range.setEndBefore(endParagraph);
            } else {
                range.setEnd(endParagraph, endParagraph.childNodes.length);
            }
        }
    }
    this.expandToParagraphBoundaries = expandToParagraphBoundaries;

    /**
     * @param {!Range} range
     * @param {!boolean} hasForwardSelection
     * @param {number=} clickCount
     */
    function selectRange(range, hasForwardSelection, clickCount) {
        var canvasElement = odtDocument.getOdfCanvas().getElement(),
            validSelection,
            startInsideCanvas,
            endInsideCanvas,
            existingSelection,
            newSelection,
            op;

        startInsideCanvas = domUtils.containsNode(canvasElement, range.startContainer);
        endInsideCanvas = domUtils.containsNode(canvasElement, range.endContainer);
        if (!startInsideCanvas && !endInsideCanvas) {
            return;
        }

        if (startInsideCanvas && endInsideCanvas) {
            // Expansion behaviour should only occur when double & triple clicking is inside the canvas
            if (clickCount === 2) {
                expandToWordBoundaries(range);
            } else if (clickCount >= 3) {
                expandToParagraphBoundaries(range);
            }
        }

        validSelection = rangeToSelection(range, hasForwardSelection);
        newSelection = odtDocument.convertDomToCursorRange(validSelection, constrain(odfUtils.getParagraphElement));
        existingSelection = odtDocument.getCursorSelection(inputMemberId);
        if (newSelection.position !== existingSelection.position || newSelection.length !== existingSelection.length) {
            op = createOpMoveCursor(newSelection.position, newSelection.length, ops.OdtCursor.RangeSelection);
            session.enqueue([op]);
        }
    }
    this.selectRange = selectRange;

    /**
     * @param {!number} lengthAdjust   length adjustment
     * @return {undefined}
     */
    function extendCursorByAdjustment(lengthAdjust) {
        var selection = odtDocument.getCursorSelection(inputMemberId),
            stepCounter = odtDocument.getCursor(inputMemberId).getStepCounter(),
            newLength;
        if (lengthAdjust !== 0) {
            lengthAdjust = (lengthAdjust > 0)
                ? stepCounter.convertForwardStepsBetweenFilters(lengthAdjust, keyboardMovementsFilter, baseFilter)
                : -stepCounter.convertBackwardStepsBetweenFilters(-lengthAdjust, keyboardMovementsFilter, baseFilter);

            newLength = selection.length + lengthAdjust;
            session.enqueue([createOpMoveCursor(selection.position, newLength)]);
        }
    }

    /**
     * @param {!number} positionAdjust   position adjustment
     * @return {undefined}
     */
    function moveCursorByAdjustment(positionAdjust) {
        var position = odtDocument.getCursorPosition(inputMemberId),
            stepCounter = odtDocument.getCursor(inputMemberId).getStepCounter();
        if (positionAdjust !== 0) {
            positionAdjust = (positionAdjust > 0)
                ? stepCounter.convertForwardStepsBetweenFilters(positionAdjust, keyboardMovementsFilter, baseFilter)
                : -stepCounter.convertBackwardStepsBetweenFilters(-positionAdjust, keyboardMovementsFilter, baseFilter);

            position = position + positionAdjust;
            session.enqueue([createOpMoveCursor(position, 0)]);
        }
    }

    /**
     * @return {!boolean}
     */
    function moveCursorToLeft() {
        moveCursorByAdjustment(-1);
        return true;
    }
    this.moveCursorToLeft = moveCursorToLeft;

    /**
     * @return {!boolean}
     */
    function moveCursorToRight() {
        moveCursorByAdjustment(1);
        return true;
    }
    this.moveCursorToRight = moveCursorToRight;

    /**
     * @return {!boolean}
     */
    function extendSelectionToLeft() {
        extendCursorByAdjustment(-1);
        return true;
    }
    this.extendSelectionToLeft = extendSelectionToLeft;

    /**
     * @return {!boolean}
     */
    function extendSelectionToRight() {
        extendCursorByAdjustment(1);
        return true;
    }
    this.extendSelectionToRight = extendSelectionToRight;

    /**
     * @param {!number} direction -1 for upwards 1 for downwards
     * @param {!boolean} extend
     * @return {undefined}
     */
    function moveCursorByLine(direction, extend) {
        var paragraphNode = odtDocument.getParagraphElement(odtDocument.getCursor(inputMemberId).getNode()),
            steps;

        runtime.assert(Boolean(paragraphNode), "SelectionController: Cursor outside paragraph");
        steps = odtDocument.getCursor(inputMemberId).getStepCounter().countLinesSteps(direction, keyboardMovementsFilter);
        if (extend) {
            extendCursorByAdjustment(steps);
        } else {
            moveCursorByAdjustment(steps);
        }
    }

    /**
     * @return {!boolean}
     */
    function moveCursorUp() {
        moveCursorByLine(-1, false);
        return true;
    }
    this.moveCursorUp = moveCursorUp;

    /**
     * @return {!boolean}
     */
    function moveCursorDown() {
        moveCursorByLine(1, false);
        return true;
    }
    this.moveCursorDown = moveCursorDown;

    /**
     * @return {!boolean}
     */
    function extendSelectionUp() {
        moveCursorByLine(-1, true);
        return true;
    }
    this.extendSelectionUp = extendSelectionUp;

    /**
     * @return {!boolean}
     */
    function extendSelectionDown() {
        moveCursorByLine(1, true);
        return true;
    }
    this.extendSelectionDown = extendSelectionDown;

    /**
     * @param {!number} direction -1 for beginning 1 for end
     * @param {!boolean} extend
     * @return {undefined}
     */
    function moveCursorToLineBoundary(direction, extend) {
        var steps = odtDocument.getCursor(inputMemberId).getStepCounter().countStepsToLineBoundary(
            direction,
            keyboardMovementsFilter
        );
        if (extend) {
            extendCursorByAdjustment(steps);
        } else {
            moveCursorByAdjustment(steps);
        }
    }

    /**
     * @return {!boolean}
     */
    function moveCursorToLineStart() {
        moveCursorToLineBoundary(-1, false);
        return true;
    }
    this.moveCursorToLineStart = moveCursorToLineStart;

    /**
     * @return {!boolean}
     */
    function moveCursorToLineEnd() {
        moveCursorToLineBoundary(1, false);
        return true;
    }
    this.moveCursorToLineEnd = moveCursorToLineEnd;

    /**
     * @return {!boolean}
     */
    function extendSelectionToLineStart() {
        moveCursorToLineBoundary(-1, true);
        return true;
    }
    this.extendSelectionToLineStart = extendSelectionToLineStart;

    /**
     * @return {!boolean}
     */
    function extendSelectionToLineEnd() {
        moveCursorToLineBoundary(1, true);
        return true;
    }
    this.extendSelectionToLineEnd = extendSelectionToLineEnd;

    /**
     * @param {!number} direction -1 for beginning, 1 for end
     * @param {!function(!Node):Node} getContainmentNode Returns a node container for the supplied node.
     *  Usually this will be something like the parent paragraph or root the supplied node is within
     * @return {undefined}
     */
    function extendCursorToNodeBoundary(direction, getContainmentNode) {
        var cursor = odtDocument.getCursor(inputMemberId),
            node = getContainmentNode(cursor.getNode()),
            selection = rangeToSelection(cursor.getSelectedRange(), cursor.hasForwardSelection()),
            newCursorSelection;

        runtime.assert(Boolean(node), "SelectionController: Cursor outside root");
        if (direction < 0) {
            selection.focusNode = /**@type{!Node}*/(node);
            selection.focusOffset = 0;
        } else {
            selection.focusNode = /**@type{!Node}*/(node);
            selection.focusOffset = node.childNodes.length;
        }
        newCursorSelection = odtDocument.convertDomToCursorRange(selection, constrain(getContainmentNode));
        session.enqueue([createOpMoveCursor(newCursorSelection.position, newCursorSelection.length)]);
    }

    /**
     * @return {!boolean}
     */
    function extendSelectionToParagraphStart() {
        extendCursorToNodeBoundary(-1, odtDocument.getParagraphElement);
        return true;
    }
    this.extendSelectionToParagraphStart = extendSelectionToParagraphStart;

    /**
     * @return {!boolean}
     */
    function extendSelectionToParagraphEnd() {
        extendCursorToNodeBoundary(1, odtDocument.getParagraphElement);
        return true;
    }
    this.extendSelectionToParagraphEnd = extendSelectionToParagraphEnd;

    /**
     * @param {!number} direction -1 for beginning, 1 for end
     * @return {!boolean}
     */
    function moveCursorToRootBoundary(direction) {
        var cursor = odtDocument.getCursor(inputMemberId),
            root = odtDocument.getRootElement(cursor.getNode()),
            newPosition;

        runtime.assert(Boolean(root), "SelectionController: Cursor outside root");
        if (direction < 0) {
            // The anchor node will already be in a walkable position having just been retrieved from the cursor
            // The rounding will only impact the new focus node
            // Need to round up as (p, 0) is potentially before the first walkable position in the paragraph
            newPosition = odtDocument.convertDomPointToCursorStep(root, 0, function (step) {
                return step === ops.StepsTranslator.NEXT_STEP;
            });
        } else {
            // Default behaviour is to round down to the previous walkable step if (p, p.childNodes.length) isn't
            // walkable. Either way, this still equates to moving to the last walkable step in the paragraph
            newPosition = odtDocument.convertDomPointToCursorStep(root, root.childNodes.length);
        }
        session.enqueue([createOpMoveCursor(newPosition, 0)]);
        return true;
    }

    /**
     * @return {!boolean}
     */
    function moveCursorToDocumentStart() {
        moveCursorToRootBoundary(-1);
        return true;
    }
    this.moveCursorToDocumentStart = moveCursorToDocumentStart;

    /**
     * @return {!boolean}
     */
    function moveCursorToDocumentEnd() {
        moveCursorToRootBoundary(1);
        return true;
    }
    this.moveCursorToDocumentEnd = moveCursorToDocumentEnd;

    /**
     * @return {!boolean}
     */
    function extendSelectionToDocumentStart() {
        extendCursorToNodeBoundary(-1, odtDocument.getRootElement);
        return true;
    }
    this.extendSelectionToDocumentStart = extendSelectionToDocumentStart;

    /**
     * @return {!boolean}
     */
    function extendSelectionToDocumentEnd() {
        extendCursorToNodeBoundary(1, odtDocument.getRootElement);
        return true;
    }
    this.extendSelectionToDocumentEnd = extendSelectionToDocumentEnd;

    /**
     * @return {!boolean}
     */
    function extendSelectionToEntireDocument() {
        var cursor = odtDocument.getCursor(inputMemberId),
            root = odtDocument.getRootElement(cursor.getNode()),
            newSelection,
            newCursorSelection;

        runtime.assert(Boolean(root), "SelectionController: Cursor outside root");
        newSelection = {
            anchorNode: root,
            anchorOffset: 0,
            focusNode: root,
            focusOffset: root.childNodes.length
        };
        newCursorSelection = odtDocument.convertDomToCursorRange(newSelection, constrain(odtDocument.getRootElement));
        session.enqueue([createOpMoveCursor(newCursorSelection.position, newCursorSelection.length)]);
        return true;
    }
    this.extendSelectionToEntireDocument = extendSelectionToEntireDocument;
};
