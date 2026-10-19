// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useMemo} from 'react'
import {useIntl} from 'react-intl'

import {IUser} from '../user'
import {useAppSelector} from '../store/hooks'
import {getMe} from '../store/users'
import {RootState} from '../store'
import {Utils} from '../utils'

import './memberVisibilityList.scss'

type Props = {
    // undefined (or empty) means visible to everyone
    restrictedUserIDs: string[] | undefined
    onChange: (userIDs: string[] | undefined) => void
}

// Inline member checklist for view-permission settings. Rendered directly
// inside a Menu (not inside a hover submenu) so checking members never fights
// the menu's hover tracking. Board admins are always checked and locked: an
// admin can never be removed, otherwise nobody could manage the board.
const MemberVisibilityList = (props: Props): JSX.Element => {
    const {restrictedUserIDs, onChange} = props
    const intl = useIntl()
    // Defensive: some test/edge states may lack these slices entirely.
    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const me = useAppSelector(getMe)
    // Defensive: some test/edge states may lack membersInBoards entirely.
    const boardMembers = useAppSelector((state: RootState) => {
        const boardId = state.boards?.current
        const all = state.boards?.membersInBoards
        return (boardId && all && all[boardId]) || {}
    })
    const clientConfigNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'

    const adminIDs = useMemo(() => {
        const ids = new Set<string>()
        Object.values(boardMembers).forEach((m) => {
            if (m.schemeAdmin) {
                ids.add(m.userId)
            }
        }
        )
        // The person configuring this passed the ManageBoardProperties gate;
        // never let them lock themselves out either.
        if (me) {
            ids.add(me.id)
        }
        return ids
    }, [boardMembers, me])

    const restricted = restrictedUserIDs !== undefined && restrictedUserIDs.length > 0

    const sortedUsers = useMemo(() => {
        return Object.values(boardUsersById).sort((a, b) => {
            const aAdmin = adminIDs.has(a.id) ? 0 : 1
            const bAdmin = adminIDs.has(b.id) ? 0 : 1
            if (aAdmin !== bAdmin) {
                return aAdmin - bAdmin
            }
            return a.username.localeCompare(b.username)
        })
    }, [boardUsersById, adminIDs])

    const toggleUser = (user: IUser) => {
        if (adminIDs.has(user.id)) {
            return
        }
        const allIDs = Object.keys(boardUsersById)
        const current = new Set<string>(restricted ? restrictedUserIDs! : allIDs)
        if (current.has(user.id)) {
            current.delete(user.id)
        } else {
            current.add(user.id)
        }
        adminIDs.forEach((id) => current.add(id))
        const next = [...current]
        // Everyone checked again -> back to "visible to everyone"
        if (next.length >= allIDs.length) {
            onChange(undefined)
        } else {
            onChange(next)
        }
    }

    const isChecked = (user: IUser): boolean => {
        if (adminIDs.has(user.id)) {
            return true
        }
        if (!restricted) {
            return true
        }
        return restrictedUserIDs!.includes(user.id)
    }

    // Invert selection for non-admin members (admins stay checked/locked).
    const invertSelection = () => {
        const allIDs = Object.keys(boardUsersById)
        const current = new Set<string>(restricted ? restrictedUserIDs! : allIDs)
        const next = new Set<string>()
        allIDs.forEach((id) => {
            if (adminIDs.has(id)) {
                next.add(id)
            } else if (!current.has(id)) {
                next.add(id)
            }
        })
        const nextArr = [...next]
        // Everyone checked again -> back to "visible to everyone"
        if (nextArr.length >= allIDs.length) {
            onChange(undefined)
        } else {
            onChange(nextArr)
        }
    }

    return (
        <div
            className='MemberVisibilityList'
            onClick={(e) => e.stopPropagation()}
        >
            <div className='visibility-list-header'>
                {intl.formatMessage({id: 'MemberVisibilityList.title', defaultMessage: 'View permissions'})}
                <span className='visibility-list-actions'>
                    <span className='visibility-list-status'>
                        {restricted ?
                            intl.formatMessage({id: 'MemberVisibilityList.restricted', defaultMessage: 'Restricted'}) :
                            intl.formatMessage({id: 'MemberVisibilityList.everyone', defaultMessage: 'Everyone'})}
                    </span>
                    <button
                        type='button'
                        className='visibility-invert-btn'
                        onClick={(e) => {
                            e.stopPropagation()
                            invertSelection()
                        }}
                        title={intl.formatMessage({id: 'MemberVisibilityList.invert', defaultMessage: '反选'})}
                    >
                        {intl.formatMessage({id: 'MemberVisibilityList.invert', defaultMessage: '反选'})}
                    </button>
                </span>
            </div>
            <div className='visibility-list-members'>
                {sortedUsers.map((user) => {
                    const locked = adminIDs.has(user.id)
                    return (
                        <label
                            key={user.id}
                            className={'visibility-member' + (locked ? ' locked' : '')}
                        >
                            <input
                                type='checkbox'
                                checked={isChecked(user)}
                                disabled={locked}
                                onChange={() => toggleUser(user)}
                            />
                            <span className='visibility-member-name'>
                                {Utils.getUserDisplayName(user, clientConfigNameDisplay)}
                            </span>
                            {locked &&
                                <span className='visibility-member-admin'>
                                    {intl.formatMessage({id: 'MemberVisibilityList.admin', defaultMessage: 'Admin'})}
                                </span>}
                        </label>
                    )
                })}
            </div>
        </div>
    )
}

export default MemberVisibilityList
