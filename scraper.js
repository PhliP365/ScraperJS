/**
 * @preserve 
 * ScraperJS Copyright (C) 2011-2012 365multimedia.com
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
 * Matches the start of a text/html document.
 *
 * @type {!RegExp}
 * @const
 */
tmc.ScraperJS.RX_HTML_SNIFFER = /^\s*<(?:!DOCTYPE\s+HTML|HTML|HEAD|SCRIPT|IFRAME|H1|DIV|FONT|TABLE|A|STYLE|TITLE|B|BODY|BR|P|!--)[\s>]/i;


/**
 * Matches the start of an application/pdf document.
 *
 * @type {!RegExp}
 * @const
 */
tmc.ScraperJS.RX_PDF_SNIFFER = /^%PDF-/;


/**
 * Matches a link depth and url (link format is linkDepthr>absoluteUrl).
 *
 * @type {!RegExp}
 * @const
 */
tmc.ScraperJS.RX_PARSE_LINK = /^([^>]*)>(.*)$/;


/**
 * Matches <base> tag's href attribute value.
 *
 * @type {!RegExp}
 * @const
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
 * @type {!RegExp}
 * @const
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
 * Defaults to 60 seconds.
 *
 * @type {!number}
 * @private
 */
tmc.ScraperJS.prototype.maxLinkFetchTime_ = 60 * 1000;


/**
 * Array of mime sniffers that will be used to determine the mime type of a document based on its first 512 characters.
 *
 * A mime sniffer is a rule consisting of (1) a regular expression (the "if" part) and (2) a mime type (the "then" part) 
 * that will be used when the regular expression matches against the document's content.
 *
 * Here is an exemple:
 * <code>
 * [
 *   {regex: /^\s*<(?:!DOCTYPE\s+HTML|HTML|HEAD|SCRIPT|IFRAME|H1|DIV|FONT|TABLE|A|STYLE|TITLE|B|BODY|BR|P|!--)[\s>]/i, mime:'text/html'},
 *   {regex: /^%PDF-/, mime:'application/pdf'}
 * ]
 * </code>
 *
 * Here is how the logic works:
 * 1. Select the first mime sniffer's regular expression and match it against the document's content
 * 2. If the match is successful, assign the sniffer's mime type value to the document and stop there
 * 3. If the match is not successful, go to the next sniffer in the array
 * 4. If nor sniffer match, set the document's mime type to null
 *
 * @type {?Array.<{regex:!RegExp, mime:string}>}
 * @private
 */
tmc.ScraperJS.prototype.mimeSniffers_ = null;


/**
 * Map of data extractors that will be used to extract data from a document. 
 *
 * The format is the following:
 * <code>
 * {
 *   'mime/type1': function1,
 *   'mime/type2': function2
 *   ...
 * }
 * </code>
 *
 * Here is how the logic works:
 * 1. Select the function corresponding to the document's mime type
 * 2. Execute the function
 *
 * @type {?Object.<!string,!function(string)>}
 * @private
 */
tmc.ScraperJS.prototype.dataExtractors_ = null;


/**
 * Map of link extractors that will be used to extract links from a document. 
 *
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
 * 1. Select the regular expression corresponding to the document's mime type
 * 2. Match the regular expression against the document's content
 * 3. For each match return the first non-undefined capture block
 *
 * @type {?Object.<!string,!RegExp>}
 * @private
 */
tmc.ScraperJS.prototype.linkExtractors_ = null;


/**
 * Array of priority rules that will be used to compute the priority of a link.
 *
 * A rule consists of (1) a regular expression (the "if" part) and (2) a priority (the "then" part) 
 * that will be used when the regular expression matches against the link.
 *
 * Here is an exemple:
 * <code>
 * [
 *   {regex: /page=/, priority: 10},
 *   {regex: /.+/, priority: -20}
 * ]
 * </code>
 *
 * The prioroity can be: 
 * <code>integer</code>: a positive or negative number (the bigger, the higher the prioroity)
 * <code>'++'</code>: highest prioroity encountered so far + 1
 * <code>'--'</code>: lowest priority encountered so far - 1
 * <code>null</code>: tells the crawler to ignore this link
 *
 * Here is how the logic works:
 * 1. Select the first rule's regular expression and match it against a link
 * 2. If the match is successful, assign the rule's priority value to the link and stop there
 * 3. If the match is not successful, go to the next rule in the array
 * 4. If no rule match, set the link's prioroity to 0
 *
 * @type {?Array.<{regex:!RegExp, priority:(?number|?string)}>}
 * @private
 */
tmc.ScraperJS.prototype.linkPriorityRules_ = null;


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
 * Hash table used to avoid duplicate results.
 *
 * @type {?Object.<number>}
 */
tmc.ScraperJS.prototype.uniqueResults_ = null;


/**
 * Sets the maximum amount of time allowed for the crawl (expressed in milliseconds, 0 for unlimited).
 *
 * @param {!number} maxCrawlTime maximum amount of time allowed for the crawl (expressed in milliseconds, 0 for unlimited).
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setMaxCrawlTime = function(maxCrawlTime) {
    this.maxCrawlTime_ = maxCrawlTime;
    return this;
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
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setMaxCrawlDepth = function(maxCrawlDepth) {
    this.maxCrawlDepth_ = maxCrawlDepth;
    return this;
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
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setMaxCrawledLinks = function(maxCrawledLinks) {
    this.maxCrawledLinks_ = maxCrawledLinks;
    return this;
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
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setMaxLinkFetchTime = function(maxLinkFetchTime) {
    this.maxLinkFetchTime_ = maxLinkFetchTime;
    return this;
};


/**
 * @return {!number} maximum amount of time allowed for fetching a link (expressed in milliseconds, 0 for unlimited).
 */
tmc.ScraperJS.prototype.getMaxLinkFetchTime = function() {
    return this.maxLinkFetchTime_;
};


/**
 * Sets the array of mime sniffers that will be used to determine the mime type of a document based on its first 512 characters.
 *
 * A mime sniffer is a rule consisting of (1) a regular expression (the "if" part) and (2) a mime type (the "then" part) 
 * that will be used when the regular expression matches against the document's content.
 *
 * Here is an exemple:
 * <code>
 * [
 *   {regex: /^\s*<(?:!DOCTYPE\s+HTML|HTML|HEAD|SCRIPT|IFRAME|H1|DIV|FONT|TABLE|A|STYLE|TITLE|B|BODY|BR|P|!--)[\s>]/i, mime:'text/html'},
 *   {regex: /^%PDF-/, mime:'application/pdf'}
 * ]
 * </code>
 *
 * Here is how the logic works:
 * 1. Select the first mime sniffer's regular expression and match it against the document's content
 * 2. If the match is successful, assign the sniffer's mime type value to the document and stop there
 * 3. If the match is not successful, go to the next sniffer in the array
 * 4. If nor sniffer match, set the document's mime type to null
 *
 * @param {?Array.<{regex:!RegExp, mime:string}>} mimeSniffers array of mime sniffers.
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setMimeSniffers = function(mimeSniffers) {
    this.mimeSniffers_ = mimeSniffers;
    return this;    
};


/**
 * Sets the map of data extractors that will be used to extract data from a document. 
 *
 * The format is the following:
 * <code>
 * {
 *   'mime/type1': function1,
 *   'mime/type2': function2
 *   ...
 * }
 * </code>
 *
 * Here is how the logic works:
 * 1. Select the function corresponding to the document's mime type
 * 2. Execute the function
 *
 * @param {?Object.<!string,!function(string)>} dataExtractors maps of data extractors.
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setDataExtractors = function(dataExtractors) {
    this.dataExtractors_ = dataExtractors;
    return this;
}


/**
 * Sets the map of link extractors that will be used to extract links from a document. 
 *
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
 * 1. Select the regular expression corresponding to the document's mime type
 * 2. Match the regular expression against the document's content
 * 3. For each match return the first non-undefined capture block
 *
 * @param {!Object.<!string,!RegExp>} linkExtractors map of link extractors.
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setLinkExtractors = function(linkExtractors) {
    this.linkExtractors_ = linkExtractors;
    return this;
}


/**
 * Sets the array of priority rules that will be used to compute the priority of a link.
 *
 * A rule consists of (1) a regular expression (the "if" part) and (2) a priority (the "then" part) 
 * that will be used when the regular expression matches against the link.
 *
 * Here is an exemple:
 * <code>
 * [
 *   {regex: /page=/, priority: 10},
 *   {regex: /.+/, priority: -20}
 * ]
 * </code>
 *
 * The prioroity can be: 
 * <code>integer</code>: a positive or negative number (the bigger, the higher the prioroity)
 * <code>'++'</code>: highest prioroity encountered so far + 1
 * <code>'--'</code>: lowest priority encountered so far - 1
 * <code>null</code>: tells the crawler to ignore this link
 *
 * Here is how the logic works:
 * 1. Select the first rule's regular expression and match it against a link
 * 2. If the match is successful, assign the rule's priority value to the link and stop there
 * 3. If the match is not successful, go to the next rule in the array
 * 4. If no rule match, set the link's prioroity to 0
 *
 * @param {Array.<{regex:!RegExp, priority:(?number|?string)}>} linkPriorityRules array of link priority rules.
 *
 * @return {!tmc.ScraperJS} scraper object so as to allow method chaining.
 */
tmc.ScraperJS.prototype.setLinkPriorityRules = function(linkPriorityRules) {
    this.linkPriorityRules_ = linkPriorityRules;
    return this;
};


/**
 * Initializes the ScraperJS's instance variables to their default value.
 */
tmc.ScraperJS.prototype.init = function() {
    var that = this;

    this.maxCrawlTime_ = 0;
    this.maxCrawlDepth_ = 0;
    this.maxCrawledLinks_ = 0;
    this.maxLinkFetchTime_ = 60 * 1000;     // 60 seconds
    this.startCrawlTime_ = 0;
    this.mimeSniffers_ =    [
                                {regex:tmc.ScraperJS.RX_HTML_SNIFFER, mime:'text/html'},
                                {regex:tmc.ScraperJS.RX_PDF_SNIFFER, mime:'application/pdf'}
                            ];
    this.dataExtractors_ =  {
                                '*/*':function(content) {
                                    var rx = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,6}/gi;
                                    var match;
                                    var sha1;
                                    var hash;

                                    while ((match = rx.exec(content)) !== null) {
                                        sha1 = new goog.crypt.Sha1();
                                        sha1.update(match[0]);
                                        hash = goog.crypt.byteArrayToString(sha1.digest());

                                        if (that.uniqueResults_[hash] === undefined) {          // Ignores results previously queued
                                            that.uniqueResults_[hash] = 1;
                                            document.write(match[0] + '</br>')
                                        }
                                    }
                                }
                            };
    this.linkExtractors_ =  {
                                'text/html':tmc.ScraperJS.RX_HTML_URL_EXTRACTOR
                            };
    this.linkPriorityRules_ = [];
    this.highestLinkPriority_ = 0;
    this.lowestLinkPriority_ = 0;
    this.linkQueue_ = new goog.structs.PriorityQueue();
    this.linkStatuses_ = {};
    this.numCrawledLinks_ = 0;
    this.uniqueResults_ = [];
};


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
                var content;
                var mime;
        		if (xhr.isSuccess()) {
                    content = xhr.getResponseText();
                    mime = that.sniffMime(content);
                    that.extractData(mime, content);
	                that.extractLinks(
                        mime,
                        content, 
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


/**
 * Determines the mime type of a document based on its first 512 characters.
 * See {@link http://mimesniff.spec.whatwg.org/}
 *
 * Here is how the logic works:
 * 1. Select the first mime sniffer's regular expression and match it against the document's content
 * 2. If the match is successful, returns the sniffer's mime type value and stop there
 * 3. If the match is not successful, go to the next sniffer in the array
 * 4. If nor sniffer match, return <code>null</code>
 *
 * @param {!string} content document's content.
 *
 * @return {?string} document's mime type or <code>null</code> if unknown.
 */ 
tmc.ScraperJS.prototype.sniffMime = function(content) {
    var first512 = content.substr(0, 512);
    var l = this.mimeSniffers_.length;
    var sniffer;

    for (var i = 0; i < l; i++) {
        sniffer = this.mimeSniffers_[i];
        if (sniffer.regex.test(first512)) {
            return sniffer.mime;
        }
    }

    return null;
};


/**
 * Extracts data from a document.
 *
 * @param {!string} mime mime type of the document.
 * @param {!string} content content of the document.
 */
tmc.ScraperJS.prototype.extractData = function(mime, content) {
    // Retrieves the data extractor for the document's mime type
    var dataExtractor = this.dataExtractors_[mime];

    // Tries to use a default data extractor if none is found for the document's mime type
    if (dataExtractor === undefined) {
        dataExtractor = this.dataExtractors_['*/*'];
    }

    // Executes the data extractor if one has been found
    if (dataExtractor !== undefined) {
        dataExtractor(content);
    }
};


/**
 * Extracts links from a document and enqueues them.
 *
 * @param {!string} mime document's mime type.
 * @param {!string} content dcoument's content.
 * @param {!string} linkUrl url of the link pointing to <code>content</code>.
 * @param {!number} linkDepth depth of the link pointing to <code>content</code>.
 */
tmc.ScraperJS.prototype.extractLinks = function(mime, content, linkUrl, linkDepth) {
    var linkExtractor;
    var match;
    var objBaseUrl;
    var objLinkUrl = new goog.Uri(linkUrl);
    var objUrl;
    var numCaptureGroups;
    var url;

    // Retrieves the link extractor for the document's mime type
    linkExtractor = this.linkExtractors_[mime];
    
    // Tries to use a default link extractor if none is found for the document's mime type
    if (linkExtractor === undefined) {
        linkExtractor = this.linkExtractors_['*/*'];
    }    

    // Bails out if not data extractor has been found
    if (linkExtractor === undefined) {
        return;
    }

    // Determines the base url
    if (mime === 'text/html') {                         // Searches for the <base> tag if dealing with an html document
        match = tmc.ScraperJS.RX_BASE_HREF.exec(content);
    }
    else {
        match = null;
    }

    if (match === null) {
        objBaseUrl = objLinkUrl;                        // If no <base> tag, the base url is the link url
    }
    else {
        try {
            objBaseUrl = new goog.Uri(match[1]);
        }
        catch (e) {                                     // Uses the link url as the base url if parsing 
            objBaseUrl = objLinkUrl;                    // the retrieved base url throws an exception
        }
    }

    // Extracts the links
    while ((match = linkExtractor.exec(content)) !== null) {
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
 *
 * @return {?goog.Uri} loatable url or <code>null</code>.
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
 * Comptutes the crawl priority of a given link.
 *
 * @param {!string} link link whose priority is to be computed.
 *
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