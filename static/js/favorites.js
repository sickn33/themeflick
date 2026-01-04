document.addEventListener('DOMContentLoaded', function() {
    const movieResults = document.getElementById('movieResults');
    const emptyState = document.getElementById('emptyState');
    
    function displayFavorites() {
        const favorites = getFavorites();
        
        if (favorites.length === 0) {
            movieResults.style.display = 'none';
            emptyState.style.display = 'flex';
            return;
        }
        
        movieResults.style.display = 'grid';
        emptyState.style.display = 'none';
        movieResults.innerHTML = '';
        
        // Ordina i preferiti per data di aggiunta (più recenti prima)
        favorites.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
        
        favorites.forEach((movie, index) => {
            // Aggiungiamo un punteggio di similarità fittizio per compatibilità con createMovieCard
            movie.similarity_score = 100;
            const movieCard = createMovieCard(movie);
            movieCard.style.animationDelay = `${index * 0.1}s`;
            movieResults.appendChild(movieCard);
        });
    }
    
    // Aggiungiamo un listener per aggiornare la vista quando cambiano i preferiti
    window.addEventListener('storage', function(e) {
        if (e.key === 'favorites') {
            displayFavorites();
        }
    });
    
    // Mostra i preferiti all'avvio
    displayFavorites();
});
