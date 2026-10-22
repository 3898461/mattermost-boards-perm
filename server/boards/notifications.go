// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package boards

import (
	"fmt"

	"github.com/mattermost/mattermost-plugin-boards/server/model"
	"github.com/mattermost/mattermost-plugin-boards/server/services/notify/notifymentions"
	"github.com/mattermost/mattermost-plugin-boards/server/services/notify/plugindelivery"
	"github.com/mattermost/mattermost-plugin-boards/server/services/permissions"
	"github.com/mattermost/mattermost-plugin-boards/server/services/store"

	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

// Notification wiring (restored 2026-10-21, mentions only).
//
// Only the @mention backend is created. The subscriptions backend stays
// disabled on purpose: it broadcast card/board change digests (including
// property diffs such as 人天/金额), which is the leak channel this
// deployment removed the bot for. Mention delivery is sanitized in
// plugindelivery.formatMessage: no board title, no property values.
type notifyBackendParams struct {
	servicesAPI model.ServicesAPI
	permissions permissions.PermissionsService
	appAPI      *appAPI
	serverRoot  string
	logger      mlog.LoggerIFace
}

func createMentionsNotifyBackend(params notifyBackendParams) (*notifymentions.Backend, error) {
	delivery, err := createDelivery(params.servicesAPI, params.serverRoot)
	if err != nil {
		return nil, err
	}

	backendParams := notifymentions.BackendParams{
		AppAPI:      params.appAPI,
		Permissions: params.permissions,
		Delivery:    delivery,
		Logger:      params.logger,
	}

	backend := notifymentions.New(backendParams)

	return backend, nil
}

func createDelivery(servicesAPI model.ServicesAPI, serverRoot string) (*plugindelivery.PluginDelivery, error) {
	bot := model.FocalboardBot

	botID, err := servicesAPI.EnsureBot(bot)
	if err != nil {
		return nil, fmt.Errorf("failed to ensure %s bot: %w", bot.DisplayName, err)
	}

	return plugindelivery.New(botID, serverRoot, servicesAPI), nil
}

type appIface interface {
	AddMemberToBoard(member *model.BoardMember) (*model.BoardMember, error)
}

// appAPI provides app and store APIs for the mention notification
// service. Where appropriate calls are made to the app layer to leverage
// the additional websocket notification logic present there, and other
// times the store APIs are called directly.
type appAPI struct {
	store store.Store
	app   appIface
}

func (a *appAPI) init(store store.Store, app appIface) {
	a.store = store
	a.app = app
}

func (a *appAPI) GetMemberForBoard(boardID, userID string) (*model.BoardMember, error) {
	return a.store.GetMemberForBoard(boardID, userID)
}

func (a *appAPI) AddMemberToBoard(member *model.BoardMember) (*model.BoardMember, error) {
	return a.app.AddMemberToBoard(member)
}
