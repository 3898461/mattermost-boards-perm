// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost-plugin-boards/server/model"
	"github.com/mattermost/mattermost-plugin-boards/server/services/audit"
)

// archiveCardsRequest is the body of POST /boards/{boardID}/archive-cards.
type archiveCardsRequest struct {
	CardIDs       []string `json:"cardIds"`
	TargetBoardID string   `json:"targetBoardId"`
}

type archiveCardsResponse struct {
	MovedCardIDs []string `json:"movedCardIds"`
	Count        int      `json:"count"`
}

// handleArchiveCards moves cards (with all their descendant blocks) to
// another board, preserving every block's original create/update
// timestamps. Board admins only: this is the server-side counterpart
// of the "历史卡片归档工具" menu entry (see app.ArchiveCardsToBoard).
func (a *API) handleArchiveCards(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	boardID := mux.Vars(r)["boardID"]

	if !a.permissions.HasPermissionToBoard(userID, boardID, model.PermissionManageBoardRoles) {
		a.errorResponse(w, r, model.NewErrPermission("access denied to archive board cards"))
		return
	}

	requestBody, err := io.ReadAll(r.Body)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	var req archiveCardsRequest
	if err = json.Unmarshal(requestBody, &req); err != nil {
		a.errorResponse(w, r, err)
		return
	}
	if len(req.CardIDs) == 0 {
		a.errorResponse(w, r, model.NewErrBadRequest("cardIds must not be empty"))
		return
	}
	if req.TargetBoardID == "" {
		a.errorResponse(w, r, model.NewErrBadRequest("targetBoardId is required"))
		return
	}

	auditRec := a.makeAuditRecord(r, "archiveCards", audit.Fail)
	defer a.audit.LogRecord(audit.LevelModify, auditRec)
	auditRec.AddMeta("boardID", boardID)
	auditRec.AddMeta("targetBoardID", req.TargetBoardID)
	auditRec.AddMeta("requestedCount", len(req.CardIDs))

	moved, err := a.app.ArchiveCardsToBoard(boardID, req.TargetBoardID, req.CardIDs, userID)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}

	resp := archiveCardsResponse{MovedCardIDs: moved, Count: len(moved)}
	data, err := json.Marshal(resp)
	if err != nil {
		a.errorResponse(w, r, err)
		return
	}
	jsonBytesResponse(w, http.StatusOK, data)

	auditRec.AddMeta("movedCount", len(moved))
	auditRec.Success()
}
