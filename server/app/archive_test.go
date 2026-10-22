// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"testing"

	"github.com/golang/mock/gomock"
	"github.com/mattermost/mattermost-plugin-boards/server/model"
	"github.com/stretchr/testify/require"
)

func TestArchiveCardsToBoard(t *testing.T) {
	th, tearDown := SetupTestHelper(t)
	defer tearDown()

	sourceBoard := &model.Board{ID: "source-board", TeamID: "team-1"}
	targetBoard := &model.Board{ID: "target-board", TeamID: "team-1"}

	card := &model.Block{ID: "card-1", BoardID: sourceBoard.ID, Type: model.TypeCard, CreateAt: 111, UpdateAt: 222}
	comment := &model.Block{ID: "comment-1", BoardID: sourceBoard.ID, ParentID: card.ID, Type: model.TypeComment, CreateAt: 113, UpdateAt: 223}
	content := &model.Block{ID: "text-1", BoardID: sourceBoard.ID, ParentID: card.ID, Type: model.TypeText, CreateAt: 114, UpdateAt: 224}
	otherCard := &model.Block{ID: "card-2", BoardID: sourceBoard.ID, Type: model.TypeCard, CreateAt: 115, UpdateAt: 225}

	t.Run("moves card subtree, preserves the exact block set", func(t *testing.T) {
		th.Store.EXPECT().GetBoard(gomock.Eq(targetBoard.ID)).Return(targetBoard, nil)
		th.Store.EXPECT().GetBoard(gomock.Eq(sourceBoard.ID)).Return(sourceBoard, nil)
		th.Store.EXPECT().GetBlocksForBoard(gomock.Eq(sourceBoard.ID)).
			Return([]*model.Block{card, comment, content, otherCard}, nil)
		// Exactly the card + its two descendants move; the other card stays.
		th.Store.EXPECT().MoveBlocksToBoard(
			gomock.Eq([]string{"card-1", "comment-1", "text-1"}),
			gomock.Eq(targetBoard.ID),
		).Return(nil)
		// The async WS broadcast looks up board members for both boards.
		th.Store.EXPECT().GetMembersForBoard(gomock.Eq(sourceBoard.ID)).Return([]*model.BoardMember{}, nil).AnyTimes()
		th.Store.EXPECT().GetMembersForBoard(gomock.Eq(targetBoard.ID)).Return([]*model.BoardMember{}, nil).AnyTimes()

		moved, err := th.App.ArchiveCardsToBoard(sourceBoard.ID, targetBoard.ID, []string{"card-1"}, "user-id-1")
		require.NoError(t, err)
		require.Equal(t, []string{"card-1"}, moved)
	})

	t.Run("unknown and non-card ids are skipped without touching the store move", func(t *testing.T) {
		th.Store.EXPECT().GetBoard(gomock.Eq(targetBoard.ID)).Return(targetBoard, nil)
		th.Store.EXPECT().GetBoard(gomock.Eq(sourceBoard.ID)).Return(sourceBoard, nil)
		th.Store.EXPECT().GetBlocksForBoard(gomock.Eq(sourceBoard.ID)).
			Return([]*model.Block{card, comment}, nil)

		moved, err := th.App.ArchiveCardsToBoard(sourceBoard.ID, targetBoard.ID, []string{"missing", "comment-1"}, "user-id-1")
		require.NoError(t, err)
		require.Empty(t, moved)
	})

	t.Run("same source and target is rejected", func(t *testing.T) {
		_, err := th.App.ArchiveCardsToBoard(sourceBoard.ID, sourceBoard.ID, []string{"card-1"}, "user-id-1")
		require.Error(t, err)
	})
}
