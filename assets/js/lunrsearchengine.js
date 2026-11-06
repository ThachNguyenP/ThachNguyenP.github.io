// Site search. Nothing is downloaded until the visitor opens the search box:
// then lunr.js and /search.json are fetched once and the index is built once.
var searchDocuments = [];
var searchIndexPromise = null;

function loadScript(src) {
    return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = function () { reject(new Error('failed to load ' + src)); };
        document.head.appendChild(s);
    });
}

function ensureSearchIndex() {
    if (searchIndexPromise) return searchIndexPromise;
    var base = document.body.getAttribute('data-baseurl') || '';
    searchIndexPromise = Promise.all([
        loadScript(base + '/assets/js/lunr.js'),
        fetch(base + '/search.json').then(function (r) { return r.json(); })
    ]).then(function (res) {
        searchDocuments = res[1];
        // Besides the normal tokens, also index a punctuation-free copy of
        // words like "Next.js", "on-rails" or "async/await", so that typing
        // "nextjs", "onrails" or "asyncawait" still finds them.
        var baseTokenizer = lunr.tokenizer;
        var joinedTokenizer = function (obj, metadata) {
            var tokens = baseTokenizer(obj, metadata);
            var extra = [];
            for (var i = 0; i < tokens.length; i++) {
                var s = tokens[i].toString();
                var joined = s.replace(/[.\-_\/]/g, '');
                if (joined !== s && joined.length > 1) {
                    extra.push(new lunr.Token(joined, tokens[i].metadata));
                }
            }
            return tokens.concat(extra);
        };
        return lunr(function () {
            this.tokenizer = joinedTokenizer;
            this.ref('id');
            this.field('title');
            this.field('tags');
            this.field('body');
            for (var i = 0; i < searchDocuments.length; i++) {
                var d = searchDocuments[i];
                this.add({ id: i, title: d.title || '', tags: d.tags || '', body: d.body || '' });
            }
        });
    });
    searchIndexPromise.catch(function () { searchIndexPromise = null; });
    return searchIndexPromise;
}

function lunr_search(term) {
    $("body").addClass("modal-open");
    $('#lunrsearchresults').stop(true, true).show();

    // Insert the modal without "show", then add it on the next frame so
    // Bootstrap's own fade + slide-down transition plays.
    document.getElementById('lunrsearchresults').innerHTML = '<div id="resultsmodal" class="modal fade d-block"  tabindex="-1" role="dialog" aria-labelledby="resultsmodal"> <div class="modal-dialog shadow" role="document"> <div class="modal-content"> <div class="modal-header" id="modtit"> <button type="button" class="close" id="btnx" data-dismiss="modal" aria-label="Close"> &times; </button> </div> <div class="modal-body"> <ul class="mb-0"> </ul>    </div> <div class="modal-footer"><button id="btnx" type="button" class="btn btn-primary btn-sm" data-dismiss="modal">Close</button></div></div> </div></div>';
    var list = document.querySelectorAll('#lunrsearchresults ul')[0];
    if (term) {
        document.getElementById('modtit').innerHTML = "<h5 class='modal-title'>Search results for '" + term + "'</h5>" + document.getElementById('modtit').innerHTML;
        list.innerHTML = "<li class='lunrsearchresult'>Searching...</li>";
        ensureSearchIndex().then(function (idx) {
            var results = idx.search(term);
            list.innerHTML = '';
            if (results.length > 0) {
                for (var i = 0; i < results.length; i++) {
                    var doc = searchDocuments[results[i]['ref']];
                    var body = doc['body'].substring(0, 160) + '...';
                    list.innerHTML = list.innerHTML + "<li class='lunrsearchresult'><a href='" + doc['url'] + "'><span class='title'>" + (doc['title'] || doc['url']) + "</span><small><span class='body'>" + body + "</span><span class='url'>" + doc['url'] + "</span></small></a></li>";
                }
            } else {
                list.innerHTML = "<li class='lunrsearchresult'>Sorry, no results found. Close & try a different search!</li>";
            }
        }).catch(function () {
            list.innerHTML = "<li class='lunrsearchresult'>Search is unavailable right now. Please try again.</li>";
        });
    }
    var modal = document.getElementById('resultsmodal');
    modal.offsetHeight; // force reflow so the transition starts from the hidden state
    requestAnimationFrame(function () { modal.classList.add('show'); });
    return false;
}

function lunr_close_results() {
    var modal = document.getElementById('resultsmodal');
    if (!modal || !modal.classList.contains('show')) return;
    modal.classList.remove('show');            // fade out + slide up (Bootstrap transition)
    var done = false;
    var finish = function () {
        if (done) return;
        done = true;
        $('#lunrsearchresults').hide();
        $("body").removeClass("modal-open");
        var input = document.getElementById('lunrsearch');
        if (input) { input.focus(); input.select(); }
    };
    $(modal).one('transitionend', finish);
    setTimeout(finish, 350);                   // fallback if transitionend never fires
}

$(function () {
    // Start loading the index as soon as the search box is opened or focused,
    // so it is usually ready by the time the visitor presses Enter.
    $('.show-search').on('click', ensureSearchIndex);
    $('#lunrsearch').on('focus', ensureSearchIndex);

    // Close buttons (× in header, "Close" in footer)
    $("#lunrsearchresults").on('click', '#btnx', lunr_close_results);

    // Click on the dark backdrop (outside .modal-dialog)
    $("#lunrsearchresults").on('click', '.modal', function (e) {
        if (e.target === this) lunr_close_results();
    });

    // Escape: first press closes the results, next press hides the search box
    $(document).on('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if ($('body').hasClass('modal-open')) {
            lunr_close_results();
            return;
        }
        var $search = $('.bd-search');
        if ($search.hasClass('search--show')) {
            $search.removeClass('search--show');
            $('#lunrsearch').trigger('blur');
        }
    });
});
