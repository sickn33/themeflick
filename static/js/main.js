let currentPage = 1;
const resultsPerPage = 10;
let allMovies = [];

document.addEventListener('DOMContentLoaded', () => {
    // Lazy loading fallback
    if (!('loading' in HTMLImageElement.prototype)) {
        const images = document.querySelectorAll('img[loading="lazy"]');
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.src; // Trigger load
                    observer.unobserve(img);
                }
            });
        });

        images.forEach(img => imageObserver.observe(img));
    }

    // Add page transition element
    const pageTransition = document.createElement('div');
    pageTransition.className = 'page-transition';
    document.body.appendChild(pageTransition);

    // Handle page transitions
    document.querySelectorAll('a').forEach(link => {
        if (link.host === window.location.host) {
            link.addEventListener('click', e => {
                e.preventDefault();
                const target = link.href;
                
                pageTransition.classList.add('active');
                setTimeout(() => {
                    window.location.href = target;
                }, 300);
            });
        }
    });

    // Add fade-in class to main content sections
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.classList.add('fade-in');
        setTimeout(() => {
            mainContent.classList.add('visible');
        }, 100);
    }

    const searchBtn = document.getElementById('searchBtn');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const movieSearch = document.getElementById('movieSearch');
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');

    // Mobile menu toggle
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            const icon = mobileMenuBtn.querySelector('i');
            icon.classList.toggle('fa-bars');
            icon.classList.toggle('fa-times');
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobileMenuBtn.contains(e.target) && !navLinks.contains(e.target) && navLinks.classList.contains('active')) {
                navLinks.classList.remove('active');
                const icon = mobileMenuBtn.querySelector('i');
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', searchMovies);
    }

    if (movieSearch) {
        movieSearch.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchMovies();
            }
        });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadMore);
    }

    // Initialize intersection observer for animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1
    });

    const observeElements = () => {
        document.querySelectorAll('.movie-card, .search-container, .hero-section > *').forEach(card => {
            observer.observe(card);
        });
    };

    // Espone la funzione per riutilizzarla dopo i risultati di ricerca
    window.observeElements = observeElements;

    observeElements();

    // Example movies click handling
    document.querySelectorAll('.example-movie').forEach(example => {
        example.addEventListener('click', () => {
            document.getElementById('movieSearch').value = example.textContent;
            document.getElementById('searchBtn').click();
        });
    });
});

function searchMovies() {
    const movieTitle = document.getElementById('movieSearch').value;
    if (!movieTitle) return;

    // Show loading indicator and results section
    document.getElementById('loadingIndicator').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('movieResults').innerHTML = '';
    document.getElementById('loadMoreBtn').style.display = 'none';

    const movieGrid = document.querySelector('.movie-grid');
    const loadingIndicator = document.querySelector('.loading-indicator');
    
    if (movieGrid) {
        movieGrid.classList.remove('visible');
    }
        
    if (loadingIndicator) {
        loadingIndicator.classList.add('visible');
    }

    fetch('/api/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: movieTitle
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.json()
                .then(err => {
                    throw new Error(err.error || 'Errore durante la ricerca dei film');
                })
                .catch(() => {
                    throw new Error('Errore durante la ricerca dei film');
                });
        }
        return response.json();
    })
    .then(data => {
        // Nasconde l'indicatore di caricamento
        document.getElementById('loadingIndicator').style.display = 'none';

        const parsedMovies = Array.isArray(data)
            ? data
            : Array.isArray(data?.results)
                ? data.results
                : [];

        if (parsedMovies.length === 0) {
            console.warn('Risposta vuota o non prevista:', data);
            const resultsContainer = document.getElementById('movieResults');
            resultsContainer.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Nessun film trovato.</p>
                </div>
            `;
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }

        allMovies = parsedMovies;
        currentPage = 1;

        const resultsContainer = document.getElementById('movieResults');

        // Aggiorna i risultati con l'animazione
        if (movieGrid) {
            movieGrid.innerHTML = '';
            movieGrid.classList.remove('visible');
            
            setTimeout(() => {
                displayMovies();
                movieGrid.classList.add('visible');
                if (typeof window.observeElements === 'function') {
                    window.observeElements();
                }
                updateLoadMoreButton();
            }, 300);
        } else {
            displayMovies();
            updateLoadMoreButton();
        }

        if (loadingIndicator) {
            loadingIndicator.classList.remove('visible');
        }
    })
    .catch(error => {
        // Nasconde l'indicatore e mostra il messaggio di errore
        document.getElementById('loadingIndicator').style.display = 'none';
        console.error('Error:', error);
        document.getElementById('movieResults').innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-circle"></i>
                <p>${error.message || 'Errore nel recupero dei film'}</p>
            </div>
        `;
        document.getElementById('loadMoreBtn').style.display = 'none';
    });
}

function displayMovies() {
    // Fail-fast nel caso in cui allMovies non sia un array
    if (!Array.isArray(allMovies)) {
        console.error('allMovies non è un array', allMovies);
        allMovies = [];
    }

    const startIdx = (currentPage - 1) * resultsPerPage;
    const endIdx = startIdx + resultsPerPage;
    const moviesToShow = allMovies.slice(startIdx, endIdx);

    const resultsContainer = document.getElementById('movieResults');
    
    if (currentPage === 1) {
        resultsContainer.innerHTML = '';
    }

    moviesToShow.forEach((movie, index) => {
        const movieCard = createMovieCard(movie);
        movieCard.style.animationDelay = `${index * 0.1}s`;
        resultsContainer.appendChild(movieCard);
    });
}

// Funzione di utilità per gestire i preferiti
function getFavorites() {
    return JSON.parse(localStorage.getItem('favorites') || '[]');
}

function addToFavorites(movie) {
    const favorites = getFavorites();
    if (!favorites.some(f => f.id === movie.id)) {
        favorites.push({
            id: movie.id,
            title: movie.title,
            poster_path: movie.poster_path,
            year: movie.year,
            rating: movie.rating,
            director: movie.director,
            genre: movie.genre,
            overview: movie.overview,
            added_at: new Date().toISOString()
        });
        localStorage.setItem('favorites', JSON.stringify(favorites));
    }
}

function removeFromFavorites(movieId) {
    const favorites = getFavorites();
    const updatedFavorites = favorites.filter(f => f.id !== movieId);
    localStorage.setItem('favorites', JSON.stringify(updatedFavorites));
}

function isMovieFavorite(movieId) {
    const favorites = getFavorites();
    return favorites.some(f => f.id === movieId);
}

function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    
    const isFavorite = isMovieFavorite(movie.id);
    const posterUrl = movie.poster_path 
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : '/static/images/no-poster.png';

    card.innerHTML = `
        <div class="movie-poster">
            <img src="${posterUrl}" alt="${movie.title} poster" loading="lazy">
            <div class="similarity-score">
                <span>${Math.round(movie.similarity_score)}%</span>
                <small>Match</small>
            </div>
            <button class="favorite-btn ${isFavorite ? 'active' : ''}" data-movie-id="${movie.id}">
                <i class="fas fa-heart"></i>
            </button>
        </div>
        <div class="movie-info">
            <h3>${movie.title}</h3>
            <div class="movie-meta">
                <span class="year">${movie.year || 'N/A'}</span>
                <span class="director">${movie.director || 'Unknown'}</span>
                <span class="rating">
                    <i class="fas fa-star"></i>
                    ${movie.rating ? movie.rating.toFixed(1) : 'N/A'}
                </span>
            </div>
            <p class="genres">${movie.genre && movie.genre.length > 0 ? movie.genre.join(', ') : 'N/A'}</p>
            <p class="overview">${movie.overview || 'No overview available.'}</p>
            <div class="movie-actions">
                <a href="/movie/${movie.id}" class="details-btn">
                    <i class="fas fa-info-circle"></i>
                    Details
                </a>
            </div>
        </div>
    `;

    // Aggiungiamo l'event listener per il pulsante dei preferiti
    const favoriteBtn = card.querySelector('.favorite-btn');
    favoriteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const movieId = parseInt(favoriteBtn.dataset.movieId);
        
        if (favoriteBtn.classList.contains('active')) {
            removeFromFavorites(movieId);
            favoriteBtn.classList.remove('active');
        } else {
            addToFavorites(movie);
            favoriteBtn.classList.add('active');
        }
    });
    
    // Add transition classes
    setTimeout(() => {
        card.classList.add('visible');
    }, 100);
    
    return card;
}

function getSimilarityColor(score) {
    if (score >= 80) return '#22c55e';  // Green
    if (score >= 60) return '#3b82f6';  // Blue
    if (score >= 40) return '#f59e0b';  // Orange
    return '#ef4444';  // Red
}

function createReviewsSection(reviews) {
    if (!reviews || reviews.length === 0) return '';

    let reviewsHtml = '<div class="movie-reviews"><h4>Reviews</h4>';
    reviews.forEach(review => {
        reviewsHtml += `
            <div class="review">
                <p>${review.text}</p>
                ${review.rating ? `<small>Rating: ${review.rating}/10</small>` : ''}
            </div>
        `;
    });
    reviewsHtml += '</div>';
    return reviewsHtml;
}

function loadMore() {
    currentPage++;
    displayMovies();
    updateLoadMoreButton();
}

function updateLoadMoreButton() {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (!loadMoreBtn || !Array.isArray(allMovies)) return;
    const hasMoreMovies = currentPage * resultsPerPage < allMovies.length;
    loadMoreBtn.style.display = hasMoreMovies ? 'block' : 'none';
}
