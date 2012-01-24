/**
 * @preserve 
 * ScraperJS -- Copyright (C) 2011-2012 365multimedia.com
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/


goog.provide('tmc.ScraperJS');

goog.require('goog.crypt');
goog.require('goog.crypt.Sha1');
goog.require('goog.net.XhrIo');
goog.require('goog.structs.PriorityQueue');
goog.require('goog.Uri');


/**
 * ScraperJS class.
 *
 * @constructor
 */
tmc.ScraperJS = function() {
    this.init();
};


/**
 * Matches a link depth and url (link format is linkDepthr>absoluteUrl).
 *
 * @const
 * @type {!RegExp}
 */
tmc.ScraperJS.RX_PARSE_LINK = /^([^>]*)>(.*)$/;

/**
 * Matches <base> tag's href attribute value.
 *
 * @const
 * @type {!RegExp}
 */
tmc.ScraperJS.RX_BASE_HREF = /<base\s+(?:[^<>\s]+\s+)*?href\s*=\s*['"]?([^'"<>\s]+)/gi;

/**
 * Matches:
 * <a> and <area> tags' href attribute value 
 * <frame> and <iframe> tags' src attribute value
 * <link> tags' href attribute value (if pointing to a feed)
 *
 * <code>
 * <                                                            tag opening
 * (?:
 *   (?:
 *     a(?:rea)?\s+                                             a or area tag
 *     (?:[^<>\s]+\s+)*?                                        other attributes
 *     href                                                     href attribute
 *     |                                                        -- or --
 *     i?frame\s+                                               frame or iframe tag
 *     (?:[^<>\s]+\s+)*?                                        other attributes
 *     src                                                      src attribute
 *   )
 *   \s*=\s*['"]?                                               equality operator
 *   ([^'"<>\s]+)                                               the url
 *   |                                                          -- or --
 *   link\s+                                                    link tag
 *   (?:
 *     (?:[^<>\s]+\s+)*?                                        other attributes
 *     type\s*=\s*['"]?application/(?:rss|atom)\+xml['"]?\s+    type attribute and its value
 *     (?:[^<>\s]+\s+)*?                                        other attributes
 *     href                                                     href attribute
 8     \s*=\s*['"]?                                             equality operator
 *     ([^'"<>\s]+)                                             the url
 *     |                                                        -- or --
 *     (?:[^<>\s]+\s+)*?                                        other attributes
 *     href                                                     href attribute
 *     \s*=\s*['"]?                                             equality operator
 *     ([^'"<>\s]+)                                             the url
 *     ['"]?\s+
 *     (?:[^<>\s]+\s+)*?                                        other attributes
 *     type\s*=\s*['"]?application/(?:rss|atom)\+xml['"<>\s]    type attribute and its value
 *   )
 * )
 * </code>
 *
 * @const
 * @type {!RegExp}
 */
tmc.ScraperJS.RX_HTML_URL_EXTRACTOR = /<(?:(?:a(?:rea)?\s+(?:[^<>\s]+\s+)*?href|i?frame\s+(?:[^<>\s]+\s+)*?src)\s*=\s*['"]?([^'"<>\s]+)|link\s+(?:(?:[^<>\s]+\s+)*?type\s*=\s*['"]?application\/(?:rss|atom)\+xml['"]?\s+(?:[^<>\s]+\s+)*?href\s*=\s*['"]?([^'"<>\s]+)|(?:[^<>\s]+\s+)*?href\s*=\s*['"]?([^'"<>\s]+)['"]?\s+(?:[^<>\s]+\s+)*?type\s*=\s*['"]?application\/(?:rss|atom)\+xml['"<>\s]))/gi;

/**
 * Maximum amount of time allowed for the crawl (expressed in milliseconds, 0 for unlimited).
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.maxCrawlTime_ = 0;

/**
 * Maximum depth allowed for the crawl (0 for unlimited).
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.maxCrawlDepth_ = 0;

/**
 * Maximum number of links to crawl (0 for unlimited).
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.maxCrawledLinks_ = 0;

/**
 * Maximum amount of time allowed for fetching a link (expressed in milliseconds, 0 for unlimited).
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.maxLinkFetchTime_ = 60 * 1000;

/**
 * List of rules to execute to compute link priority.
 *
 * @type {?Array.<!Object>}
 * @private
 */
tmc.ScraperJS.prototype.linkPriorityRules_ = null;

/**
 * Highest link priority so far.
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.highestLinkPriority_ = 0;

/**
 * Lowest link priority so far.
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.lowestLinkPriority_ = 0;

/**
 * Priority queue storing the links waiting to be crawled.
 *
 * @type {?goog.structs.PriorityQueue}
 * @private
 */
tmc.ScraperJS.prototype.linkQueue_ = null;

/**
 * Hash table used to avoid duplicate links.
 *
 * @type {?Object.<number>}
 * @private
 */
tmc.ScraperJS.prototype.linkStatuses_ = null;

/**
 * Time when the crawl was started (expressed in milliseconds since the epoch).
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.startCrawlTime_ = 0;

/**
 * Number of links that have been crawled so far.
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.numCrawledLinks_ = 0;

/**
 * The link extractors that the ScraperJS should be using to extract links from a document. 
 * The format is the following:
 * <code>
 * {
 *   'mime/type1': regex1,
 *   'mime/type2': regex2
 *   ...
 * }
 * </code>
 *
 * Here is how the logic works:
 * 1. Select the regular expression corresponding to the document mime type
 * 2. Match the regular expression against the document
 * 3. For each match return the first non-undefined capture block
 *
 * @type {?Object.<!RegExp>}
 */
tmc.ScraperJS.prototype.linkExtractors_ = null;

/**
 * Hash table used to avoid duplicate results.
 *
 * @type {?Object.<number>}
 */
tmc.ScraperJS.prototype.uniqueResults_ = null;

/**
 * Sets the maximum amount of time allowed for the crawl (expressed in milliseconds, 0 for unlimited).
 *
 * @param {!number} maxCrawlTime maximum amount of time allowed for the crawl (expressed in milliseconds, 0 for unlimited).
 */
tmc.ScraperJS.prototype.setMaxCrawlTime = function(maxCrawlTime) {
    this.maxCrawlTime_ = maxCrawlTime;
};


/**
 * @return {!number} maximum amount of time allowed for the crawl (expressed in milliseconds, 0 for unlimited).
 */
tmc.ScraperJS.prototype.getMaxCrawlTime = function() {
    return this.maxCrawlTime_;
};


/**
 * Sets the maximum depth allowed for the crawl (0 for unlimited).
 *
 * @param {!number} maxCrawlDepth maximum depth allowed for the crawl (0 for unlimited).
 */
tmc.ScraperJS.prototype.setMaxCrawlDepth = function(maxCrawlDepth) {
    this.maxCrawlDepth_ = maxCrawlDepth;
};


/**
 * @return {!number} maximum depth allowed for the crawl (0 for unlimited).
 */
tmc.ScraperJS.prototype.getMaxCrawlDepth = function() {
    return this.maxCrawlDepth_;
};


/**
 * Sets the maximum number of links to crawl (0 for unlimited).
 *
 * @param {!number} maxCrawledLinks maximum number of links to crawl (0 for unlimited).
 */
tmc.ScraperJS.prototype.setMaxCrawledLinks = function(maxCrawledLinks) {
    this.maxCrawledLinks_ = maxCrawledLinks;
};


/**
 * @return {!number} maximum number of links to crawl (0 for unlimited).
 */
tmc.ScraperJS.prototype.getMaxCrawledLinks = function() {
    return this.maxCrawledLinks_;
};


/**
 * Sets the maximum amount of time allowed for fetching a link (expressed in milliseconds, 0 for unlimited).
 *
 * @param {!number} maxLinkFetchTime maximum amount of time allowed for fetching a link (expressed in milliseconds, 0 for unlimited).
 */
tmc.ScraperJS.prototype.setMaxLinkFetchTime = function(maxLinkFetchTime) {
    this.maxLinkFetchTime_ = maxLinkFetchTime;
};


/**
 * @return {!number} maximum amount of time allowed for fetching a link (expressed in milliseconds, 0 for unlimited).
 */
tmc.ScraperJS.prototype.getMaxLinkFetchTime = function() {
    return this.maxLinkFetchTime_;
};

/* Moved to the bookmarklet code because of IE

    // Remove all elements from the DOM so it is ready to 
    // render the UI
    //
    function clearDom() {
        // Using document.write(): seems to be the best method
        document.open();
        document.write('<!DOCTYPE html><html><head></head><body>+</body></html>');
        document.close();

        // Using the DOM
        // var htmlElement;
        // var bodyElement;
        //
        // document.removeChild(document.documentElement);
        // htmlElement = document.createElement('html');
        // bodyElement = document.createElement('body');
        // bodyElement.innerHTML = "+";
        // htmlElement.appendChild(bodyElement);
        // document.appendChild(htmlElement);

        // Using jQuery - but how do we recreate and append the html element?
        // $('html').remove();
    }
*/

/*
    function removeElementFromDom(element) {
        var children;
        var i;
        var attributes;
        var attributeName;

        if (element) {
            children = element.childNodes;
            if (children) {
                for (i = children.length - 1; i >= 0; i--) {
                     removeElementFromDom(children[i]);
                }
            }

            attributes = element.attributes;
            if (attributes) {
                for (i = attributes.length - 1; i >= 0; i--) {
                    attributeName = attributes[i].name;
                    if (typeof element.getAttribute(attributeName) === 'function') {
                        element.removeAttribute(attributeName) = null;
                    }
                }
            }

            element.parentNode.removeChild(element);
        }
    }
*/


/**
 * Initializes the ScraperJS's instance variables to their default value.
 */
tmc.ScraperJS.prototype.init = function() {
    this.maxCrawlTime_ = 0;
    this.maxCrawlDepth_ = 0;
    this.maxCrawledLinks_ = 0;
    this.maxLinkFetchTime_ = 60 * 1000; // One minute
    this.linkPriorityRules_ = [];
    this.highestLinkPriority_ = 0;
    this.lowestLinkPriority_ = 0;
    this.linkQueue_ = new goog.structs.PriorityQueue();
    this.linkStatuses_ = {};
    this.startCrawlTime_ = 0;
    this.numCrawledLinks_ = 0;
    this.linkExtractors_ = {'text/html':tmc.ScraperJS.RX_HTML_URL_EXTRACTOR};
    this.uniqueResults_ = [];
};


/**
 * Sets the link extractors that the ScraperJS should be using to extract links from a document. 
 * The format is the following:
 * <code>
 * {
 *   'mime/type1': regex1,
 *   'mime/type2': regex2
 *   ...
 * }
 * </code>
 *
 * Here is how the logic works:
 * 1. Select the regular expression corresponding to the document mime type
 * 2. Match the regular expression against the document
 * 3. For each match return the first non-undefined capture block
 *
 * @param {!Object.<!RegExp>} linkExtractors the link extractors.
 * @return {!tmc.ScraperJS} the ScraperJS object to allow chaining calls.
 */
tmc.ScraperJS.prototype.linkExtractors = function(linkExtractors) {
    this.linkExtractors_ = linkExtractors;
    return this;
}


/**
 * Starts the ScraperJS.
 */
tmc.ScraperJS.prototype.start = function() {
    var now = new Date();

    this.startCrawlTime_ = now.getTime();
    console.log('Started crawling at ' + now.toLocaleString());

    this.clearAllTimers(window);

    this.enqueueLink(window.location.href, 0);          // Starts the crawl with the current link
    this.crawlNextLink();    
};


/**
 * Clears all (<code>setTimeout</code> and <code>setInterval</code>) timers so as to prevent 
 * unwanted <code>window.location</code> changes and refreshes.
 * Inspired by {@link http://userscripts.org/scripts/review/12732}
 *
 * @param {!Object} objWindow object holding the timers (typically window).
 */
tmc.ScraperJS.prototype.clearAllTimers = function(objWindow) {
    var id;
    var minId;

    // Clears setTimeout timers 
    id = objWindow.setTimeout(function(){}, 60000);     // Gets the last setTimeout timer id
    console.log("Last setTimeout id: " + id);
    minId = Math.max(0, id - 99999999);                 // Limits the number of loops to something reasonable

    for (; id >= minId; id--) {                         // Starts with the newest timer and go down
        try {											
            objWindow.clearTimeout(id);
        }
        catch (e) {										// Ignores errors
        }
    }

    // Clears setInterval timers
    id = objWindow.setInterval(function(){}, 60000);    // Gets the last setInterval timer id
    console.log("Last setInterval id: " + id);
    minId = Math.max(0, id - 99999999);                 // Limits the number of loops to something reasonable

    for (; id >= minId; id--) {                         // Starts with the newest timer and go down
        try {											
            objWindow.clearInterval(id);
        }
        catch (e) {										// Ignores errors
        }
    }
};


/**
 * Crawls the next link in the queue.
 */
tmc.ScraperJS.prototype.crawlNextLink = function() {
    var elapsedTime = (new Date()).getTime() - this.startCrawlTime_;
    var link;

    if (((this.maxCrawledLinks_ === 0) || (this.numCrawledLinks_ < this.maxCrawledLinks_))
        && ((this.maxCrawlTime_ === 0) || (elapsedTime < this.maxCrawlTime_))
        && !this.linkQueue_.isEmpty()) {

        link = this.linkQueue_.dequeue().toString();    // toString is to eliminate a closure warning
        this.numCrawledLinks_++;

        if ((this.numCrawledLinks_ % 10) === 0) {   
            console.log(this.numCrawledLinks_ + ' / ' + this.linkQueue_.getCount() + '    ' + link); 
        }
        this.crawlLink(link);
    }
};


/** 
 * Crawls a link (link format is linkDepthr>absoluteUrl).
 *
 * @param {!string} link link to visit (link format is linkDepthr>absoluteUrl).
 */
tmc.ScraperJS.prototype.crawlLink = function(link) {
    var match = link.match(tmc.ScraperJS.RX_PARSE_LINK);    // Extracts link depth and url
    var that = this;

    if (match !== null) {
    	goog.net.XhrIo.send(
        	match[2],                                       // match[2] is the link url
        	function(e) {
        		var xhr = e.target;
                var html;
        		if (xhr.isSuccess()) {
                    html = xhr.getResponseText();
                    that.processHtml(html);
	                that.extractLinks(
                        html, 
                        xhr.getLastUri(), 
                        parseInt(match[1], 10));            // match[1] is the link depth
	                that.crawlNextLink();
                }
                else {
                    that.crawlNextLink();                   // Ignores errors for the time being
            	}
        	},
        	'GET', 
            undefined,
            undefined,
        	this.maxLinkFetchTime_                          // timeout                    
        );
    }
};


/*
    function extractLinksFromDom() {
        var objPageUrl;
        var strBaseUrl;
        var objBaseUrl;

        objPageUrl = nodeUrl.parse(window.location.href);

        // Determine the base url
        strBaseUrl = $('base[href]').attr('href');
        if (strBaseUrl === undefined) {
            objBaseUrl = objPageUrl;
        }
        else {
            objBaseUrl = nodeUrl.parse(strBaseUrl);
        }

        // Extract <a> and <area> tags' href attribute
        $('a[href]').add('area[href]').each(function() {
            var objUrl = nodeUrl.parse($(this).attr('href'));
            objUrl = getLoadableUrlObj(objUrl, objBaseUrl, objPageUrl);

            if (objUrl !== null) {
                enqueue(nodeUrl.format(objUrl), 1);
            }
        });

        // Extract <frame> and <iframe> tags' src attribute 
        $('frame[src]').add('iframe[src]').each(function() {
            var objUrl = nodeUrl.parse($(this).attr('src'));
            urlObj = getLoadableUrlObj(objUrl, objBaseUrl, objPageUrl);
            
            if (objUrl !== null) {
                enqueue(nodeUrl.format(objUrl), 1);
            }
        });
    }
*/

/**
 * Process HTML
 *
 * @param html the html code to process.
 */
tmc.ScraperJS.prototype.processHtml = function(html) {
    var rx = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,6}/gi;
    var match;
    var sha1;
    var hash;

    while ((match = rx.exec(html)) !== null) {
        sha1 = new goog.crypt.Sha1();
        sha1.update(match[0]);
        hash = goog.crypt.byteArrayToString(sha1.digest());

        if (this.uniqueResults_[hash] === undefined) {          // Ignores results previously queued
            this.uniqueResults_[hash] = 1;
            document.write(match[0] + '</br>')
        }
    }
};


/**
 * Extracts the links from a piece of html and enqueues them.
 *
 * @param {!string} linkHtml html code.
 * @param {!string} linkUrl url of the link pointing to <code>linkHtml</code>.
 * @param {!number} linkDepth depth of the link pointing to <code>linkHtml</code>.
 */
tmc.ScraperJS.prototype.extractLinks = function(linkHtml, linkUrl, linkDepth) {
    var match;
    var objBaseUrl;
    var objLinkUrl = new goog.Uri(linkUrl);
    var objUrl;
    var linkExtractor;
    var numCaptureGroups;
    var url;

    // Determines the base url
    match = tmc.ScraperJS.RX_BASE_HREF.exec(linkHtml);
    if (match === null) {
        objBaseUrl = objLinkUrl;
    }
    else {
        try {
            objBaseUrl = new goog.Uri(match[1]);
        }
        catch (e) {                                     // Uses the link url as the base url if parsing 
            objBaseUrl = objLinkUrl;                    // the retrieved base url throws an exception
        }
    }

    linkExtractor = this.linkExtractors_['text/html'];

    while ((match = linkExtractor.exec(linkHtml)) !== null) {
        numCaptureGroups = match.length;
        for (var i = 1; i < numCaptureGroups; i++) {    // Finds the first non-undefined capture group
            url = match[i];
            if (url !== undefined) {
                break;
            }
        }

        try {
            objUrl = new goog.Uri(url);
        }
        catch (e) {
            continue;                                   // Skips urls that throw an exception when parsed
        }

        objUrl = this.getLoadableUrlObj(objUrl, objBaseUrl, objLinkUrl);
        if (objUrl !== null) {
            this.enqueueLink(objUrl.toString(), 1 + linkDepth);
        }
    }
};


/**
 * Turns a url into a loadable one. A url is loadable if it is absolute and has the same
 * protocol, authentication, hostname as the link trying to load it. Hash portion is removed.
 *
 * @param {!goog.Uri} objUrl url to be made into a loadable one.
 * @param {!goog.Uri} objBaseUrl base url for the document located at <code>objDocumentUrl</code>.
 * @param {!goog.Uri} objDocumentUrl url of the document containing a reference to <code>objUrl</code>.
 */
tmc.ScraperJS.prototype.getLoadableUrlObj = function(objUrl, objBaseUrl, objDocumentUrl) {
	var objLoadableUrl;

	try {
        objLoadableUrl = objUrl.clone();

        // Handles relative urls
        if (!objLoadableUrl.hasScheme()) {      // a relative url -> resolve it
            objLoadableUrl = objBaseUrl.resolve(objLoadableUrl);
        }

        // Handles the protocol
        if (objLoadableUrl.getScheme() !== objDocumentUrl.getScheme()) {
            return null;
        }

        // Handles the authentication
        if (objLoadableUrl.getUserInfo() !== objDocumentUrl.getUserInfo()) {
            return null;
        }

        // Handles the port
        if (objLoadableUrl.getPort() !== objDocumentUrl.getPort()) {
            return null;
        }
        
        // Eliminates the hash
        objLoadableUrl.setFragment('');

        // Handles the hostname
        if (objLoadableUrl.getDomain() === objDocumentUrl.getDomain()) {
            return objLoadableUrl;
        }

        // Tries to add or remove "www." so hostnames match
        if ((('www.' + objLoadableUrl.getDomain()) === objDocumentUrl.getDomain()) ||
            (objLoadableUrl.getDomain() === ('www.' + objDocumentUrl.getDomain()))) {
                return objLoadableUrl.setDomain(objDocumentUrl.getDomain());
        }
    }
    catch (e) {		// if an exception is thrown, null will be returned below
    }

    return null;
};


/**
 * Enqueues a link.
 *
 * @param {!string} linkUrl url of the link to enqueue.
 * @param {!number} linkDepth depth of the link to enqueue.
 */
tmc.ScraperJS.prototype.enqueueLink = function(linkUrl, linkDepth) {
    var sha1; 
    var hash;
    var link;
    var priority;

    if ((linkDepth <= this.maxCrawlDepth_) || (this.maxCrawlDepth_ === 0)) {    // Limits crawl depth
        sha1 = new goog.crypt.Sha1();
        sha1.update(linkUrl);
        hash = goog.crypt.byteArrayToString(sha1.digest());

        if (this.linkStatuses_[hash] === undefined) {                           // Ignores links previously queued
            link = linkDepth + '>' + linkUrl;
            priority = this.computeLinkPriority(link);
            if (priority !== null) {                                            // Ignores links whose priority is null
                this.linkStatuses_[hash] = 1;
                this.linkQueue_.enqueue(priority, link);
            }
        }
    }
};


/**
 * Adds a new link priority rule to the ScraperJS. A rule consists of (1) a regular expression (the "if" part)
 * and (2) a priority that will be used when the regular expression matches a link (the "then" part).
 *
 * @param {!RegExp|!string} regex regular expression used to match the rule.
 * @param {!number|!string|null} priority priority to be assigned by the rule: 
 * an <code>integer</code>, <code>'++'</code>, <code>'--'</code>, or <code>null</code>.
 */
tmc.ScraperJS.prototype.addLinkPriorityRule = function(regex, priority) {
    var rx;

    if (typeof regex === 'string') {
        rx = new RegExp(regex);         // If a string was passed it gets compiled into a regular expression 
    }
    else {
        rx = regex;
    }

    this.linkPriorityRules_.push({regex: rx, priority: priority});
};


/**
 * Comptutes the crawl priority of a given link.
 *
 * @param {!string} link link whose priority is to be computed.
 * @return {?number} computed priority of the link or <code>null</code> if the link is to be ignored.
 */
tmc.ScraperJS.prototype.computeLinkPriority = function(link) {
    var l = this.linkPriorityRules_.length;
    var rule;
    var priority;

    for (var i = 0; i < l; i++) {       // Rules are evaluated in sequencial order
        rule = linkPriorityRules_[i];
        if (rule.regex.test(link)) {    // Rule i matched the link
            priority = rule.priority;

            switch(priority) {
                case '++':              // Special code indicating that the priority should be the highest one + 1
                    priority = highestLinkPriority++;
                    break;

                case '--':              // Special code indicating that the priority should be the lowest one - 1
                    priority = lowestLinkPriority--;
                    break;

                default:                // Updates the minimum and maximum link priorities as needed
                    if (priority > highestLinkPriority) {
                        highestLinkPriority = priority;
                    }
                    else if (priority < lowestLinkPriority) {
                        lowestLinkPriority = priority;
                    }
                    break;
            }

            return priority;            // Returns after the *** first *** match
        }
    }

    return 0;                           // Returns the default priority if no match
};


goog.exportSymbol('tmc.ScraperJS', tmc.ScraperJS);


if (COMPILED) {     // Starts the process here when compiled otherwise started by bookmarklet
    ScraperJS = new tmc.ScraperJS();
    ScraperJS.start();
}