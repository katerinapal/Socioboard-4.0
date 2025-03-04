const db = require('../sequelize-cli/models/index');
const CoreServices = require('../utility/coreServices');
const moment = require('moment');
const lodash = require('lodash');

const socialAccount = db.social_accounts;
const scheduleDetails = db.users_schedule_details;
const userTeamJoinTable = db.join_table_users_teams;
const teamSocialAccountJoinTable = db.join_table_teams_social_accounts;
const accountFeedsUpdateTable = db.social_account_feeds_updates;
const Operator = db.Sequelize.Op;

const updateFriendsTable = db.social_account_friends_counts;

const coreServices = new CoreServices();
const UserTeamAccount = {

    isTeamValidForUser(userId, teamId) {
        return new Promise((resolve, reject) => {
            // Checking whether that user is belongs to that Team or not
            return userTeamJoinTable.findOne({
                where: {
                    user_id: userId,
                    team_id: teamId,
                    left_from_team: false
                },
                attributes: ['id', 'user_id']
            })
                .then((result) => {
                    if (result) resolve();
                    else throw new Error("User not belongs to the team!");
                })
                .catch((error) => {
                    reject(error);
                });
        });
    },

    isAccountValidForTeam(teamId, accountId) {
        return new Promise((resolve, reject) => {
            // Checking whether that account is belongs to that Team or not
            return teamSocialAccountJoinTable.findOne({
                where: {
                    account_id: accountId,
                    team_id: teamId,
                    is_account_locked: 0
                },
            })
                .then((result) => {
                    if (result) resolve();
                    else throw new Error("Account isnt belongs to team or account is locked for the team!");
                })
                .catch((error) => {
                    reject(error);
                });
        });
    },

    isTeamAccountValidForUser(userId, teamId, accountId) {
        return new Promise((resolve, reject) => {
            // Checking whether that user is belongs to that Team or not
            return this.isTeamValidForUser(userId, teamId)
                .then(() => {
                    // Checking whether that account is belongs to that Team or not
                    return this.isAccountValidForTeam(teamId, accountId);
                })
                .then(() => resolve())
                .catch((error) => { reject(error); });
        });
    },

    getUserTeams(userId) {
        return new Promise((resolve, reject) => {
            if (!userId) {
                reject(new Error("Invalid userId"));
            } else {
                // Fetching all Teams of an user
                return userTeamJoinTable.findAll({
                    where: { user_id: userId, left_from_team: 0, invitation_accepted: 1 },
                    attributes: ["id", "team_id"]
                })
                    .then((response) => {
                        var teamIds = [];
                        response.map(element => {
                            if (element.team_id)
                                teamIds.push(element.team_id);
                        });

                        resolve(teamIds);
                    })
                    .catch((error) => {
                        reject(error);
                    });
            }
        });
    },

    getAccountsTeam(accountId) {
        return new Promise((resolve, reject) => {
            // Fetching the Team which the account is belongs to
            return teamSocialAccountJoinTable.findAll({
                where: {
                    account_id: accountId,
                    is_account_locked: false
                },
                attributes: ["id", 'team_id']
            }).then((teams) => {
                var teamIds = [];
                teams.map(element => {
                    if (element.team_id)
                        teamIds.push(element.team_id);
                });
                resolve(teamIds);
            }).catch((error) => {
                reject(error);
            });
        });
    },

    isAccountValidForUser(userId, accountId) {
        return new Promise((resolve, reject) => {
            var accountTeams = [];
            var userTeams = [];
            // Fetching user teams
            return this.getUserTeams(userId)
                .then((userTeam) => {
                    userTeams = userTeam;
                    // Fetching the Team which the account is belongs to
                    return this.getAccountsTeam(accountId);
                })
                .then((accountTeam) => {
                    accountTeams = accountTeam;
                    // Validating that the user Teams consist of account Team or not
                    var intersectTeams = lodash.intersection(accountTeams, userTeams);
                    resolve({ isValid: intersectTeams.length > 0 ? true : false, intersectTeams: intersectTeams });
                })
                .catch((error) => {
                    reject(error);
                });
        });
    },

    getSocialAccount(accountType, accountId, userId, teamId) {
        return new Promise((resolve, reject) => {

            if (!accountType || !accountId || !userId || !teamId) {
                reject(new Error("Please verify your inputs: 1. Account id, \n\r 2.Team id"));
            } else {
                // Validating that the account is valid for user
                return this.isTeamAccountValidForUser(userId, teamId, accountId)
                    .then(() => {
                        return socialAccount.findOne({
                            where: {
                                account_type: accountType,
                                account_id: accountId
                            }
                        });
                    })
                    .then((accountDetails) => {
                        if (!accountDetails) {
                            accountType = accountType instanceof Array ? accountType[0] : accountType;
                            var networkName = coreServices.getNetworkName(accountType);
                            throw new Error(`No profile found or account isn't ${networkName.toLowerCase()} profile.`);
                        }
                        else
                            resolve(accountDetails);
                    })
                    .catch((error) => reject(error));
            }
        });
    },

    isNeedToFetchRecentPost(accountId, frequencyValue, frequencyFactor) {
        return new Promise((resolve, reject) => {
            if (!accountId || !frequencyValue || !frequencyFactor) {
                reject(new Error("Please verify account id valid or not!"));
            } else {
                // Fetching account feed updated details
                return accountFeedsUpdateTable.findOne({
                    where: {
                        account_id: accountId
                    }
                })
                    .then((result) => {
                        if (!result)
                            resolve(true);
                        else {
                            // Calculating the difference
                            var difference = moment.tz(new Date(), "GMT").diff(moment.tz(result.updated_date, 'GMT'), frequencyFactor);
                            // Sending yes or no to Fetch or not 
                            resolve(difference > frequencyValue);
                        }
                    })
                    .catch((error) => {
                        reject(error);
                    });
            }
        });
    },

    createOrEditLastUpdateTime(accountId, socialId) {
        return new Promise((resolve, reject) => {
            if (!accountId) {
                reject(new Error("Please verify account id!"));
            } else {
                // Fetching details of feed update of an account
                return accountFeedsUpdateTable.findOne({
                    where: { account_id: accountId }
                })
                    .then((result) => {
                        if (!result) {
                            // Creating data in feed update for an account
                            return accountFeedsUpdateTable.create({
                                account_id: accountId,
                                social_id: socialId,
                                updated_date: moment.utc().format()
                            });
                        } else
                            // Updating the existing account details
                            return result.update({ updated_date: moment.utc().format() });
                    })
                    .then(() => resolve())
                    .catch((error) => reject(error));
            }
        });
    },

    createOrUpdateFriendsList(accountId, data) {
        return new Promise((resolve, reject) => {
            if (!accountId || !data) {
                reject(new Error("Please verify account id or data to update!"));
            } else {
                // Fetching details of friends stats of an account
                return updateFriendsTable.findOne({
                    where: { account_id: accountId }
                })
                    .then((result) => {
                        if (!result) {
                            // If not found, Adding details to that table
                            return updateFriendsTable.create({
                                account_id: accountId,
                                friendship_count: data.friendship_count == undefined ? null : data.friendship_count,
                                follower_count: data.follower_count == undefined ? null : data.follower_count,
                                following_count: data.following_count == undefined ? null : data.following_count,
                                page_count: data.page_count == undefined ? null : data.page_count,
                                group_count: data.group_count == undefined ? null : data.group_count,
                                board_count: data.board_count == undefined ? null : data.board_count,
                                subscription_count: data.subscription_count == undefined ? null : data.subscription_count,
                                total_like_count: data.total_like_count == undefined ? null : data.total_like_count,
                                total_post_count: data.total_post_count == undefined ? null : data.total_post_count,
                                bio_text: data.bio_text ? data.bio_text : null,
                                profile_picture: data.profile_picture ? data.profile_picture : null,
                                cover_picture: data.cover_picture ? data.cover_picture : null,
                                updated_date: moment.utc().format()
                            });
                        } else
                            // If found, updating the existed values
                            return result.update({
                                friendship_count: data.friendship_count == undefined ? null : data.friendship_count,
                                follower_count: data.follower_count == undefined ? null : data.follower_count,
                                following_count: data.following_count == undefined ? null : data.following_count,
                                page_count: data.page_count == undefined ? null : data.page_count,
                                group_count: data.group_count == undefined ? null : data.group_count,
                                board_count: data.board_count == undefined ? null : data.board_count,
                                subscription_count: data.subscription_count == undefined ? null : data.subscription_count,
                                total_like_count: data.total_like_count == undefined ? null : data.total_like_count,
                                total_post_count: data.total_post_count == undefined ? null : data.total_post_count,
                                bio_text: data.bio_text ? data.bio_text : null,
                                profile_picture: data.profile_picture ? data.profile_picture : null,
                                cover_picture: data.cover_picture ? data.cover_picture : null,
                                updated_date: moment.utc().format()
                            });
                    })
                    .then((data) => resolve(data))
                    .catch((error) => reject(error));
            }
        });
    }




};

module.exports = UserTeamAccount;